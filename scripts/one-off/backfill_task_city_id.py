"""
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
DANGER — ONE-OFF SCRIPT. ALREADY RUN ON PRODUCTION. DO NOT RE-RUN.

This script was run on 2026-05-01 (commit bb0fbb3) to backfill city_id on
vibe_tasks and delete orphan/duplicate city docs. Re-running it without manual
validation will DELETE city docs from Firestore that may have since been
re-ingested with valid data (e.g., bellevue, new-york, birmingham-al).

If you need to re-run, first verify each city in the DELETE list against
global_city_cache.json and confirm 0 waypoints in Firestore before proceeding.
Never run --run without reviewing --dry-run output first.

Moved from src/pipeline/ to scripts/one-off/ post-council-review (PR #49).
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

Backfill city_id on vibe_tasks + clean up orphan/duplicate city docs.

Performs three operations in order:

1. DELETE orphan city docs that are in Firestore but not in global_city_cache.json
   and have 0 waypoints (bellevue, bellevue-wa-usa, new-york).

2. DELETE birmingham-al city doc (duplicate of birmingham with messy neighborhood
   IDs). The birmingham doc is the correct one — proper US neighborhoods, good
   data from the original pipeline run.

3. BACKFILL city_id on all vibe_tasks documents. Tasks store neighborhood_id but
   not city_id, making city-level task queries impossible. Neighborhoods store
   city_id, so this is a pure programmatic lookup:
     neighborhood_id → city_id (from vibe_neighborhoods or nested subcollections)
     → write to vibe_tasks.

   ~7,027 tasks have neighborhood IDs that no longer exist in Firestore (orphaned
   from cities that were re-ingested with different neighborhood IDs). Pass
   --delete-orphans to remove them, or leave them in place (they are unserveable
   to the app without a valid neighborhood).

Usage:
    python3.12 src/pipeline/backfill_task_city_id.py                    # dry run
    python3.12 src/pipeline/backfill_task_city_id.py --run              # live writes
    python3.12 src/pipeline/backfill_task_city_id.py --run --delete-orphans  # also delete orphaned tasks
"""

import argparse
import sys
from google.cloud import firestore

GCP_PROJECT = "urban-explorer-483600"
DATABASE = "urbanexplorer"

# Orphan city docs: in Firestore, not in global_city_cache.json, 0 waypoints.
ORPHAN_CITY_IDS = {"bellevue", "bellevue-wa-usa", "new-york"}

# Duplicate city doc to remove (birmingham is correct; birmingham-al is the
# messy PR #43 duplicate with doubled neighborhood entries).
DUPLICATE_CITY_IDS = {"birmingham-al"}

BATCH_SIZE = 400  # stay under Firestore's 500-op limit with headroom


def delete_city_and_subcollections(db: firestore.Client, city_id: str, dry_run: bool) -> int:
    """Delete a city doc, all its nested subcollections, and its flat-collection entries.

    Firestore does not cascade-delete subcollections, so we must walk them
    explicitly. Returns count of deleted documents.
    """
    deleted = 0
    city_ref = db.collection("cities").document(city_id)

    # Walk neighborhoods → waypoints/tasks
    nbhd_refs = list(city_ref.collection("neighborhoods").stream())
    for nbhd in nbhd_refs:
        for sub in ("waypoints", "tasks"):
            for doc in city_ref.collection("neighborhoods").document(nbhd.id).collection(sub).stream():
                print(f"  del cities/{city_id}/neighborhoods/{nbhd.id}/{sub}/{doc.id}")
                if not dry_run:
                    doc.reference.delete()
                deleted += 1
        print(f"  del cities/{city_id}/neighborhoods/{nbhd.id}")
        if not dry_run:
            nbhd.reference.delete()
        deleted += 1

    print(f"  del cities/{city_id}")
    if not dry_run:
        city_ref.delete()
    deleted += 1

    # Remove from flat collections
    for collection in ("vibe_neighborhoods", "vibe_waypoints", "vibe_tasks"):
        query = db.collection(collection).where(filter=firestore.FieldFilter("city_id", "==", city_id))
        flat_docs = list(query.stream())
        for doc in flat_docs:
            print(f"  del {collection}/{doc.id}")
            if not dry_run:
                doc.reference.delete()
            deleted += 1

    return deleted


def backfill_task_city_ids(db: firestore.Client, dry_run: bool, delete_orphans: bool = False) -> tuple[int, int, int, int]:
    """Add city_id to vibe_tasks docs that lack it.

    Returns (updated, skipped_already_has, skipped_no_neighborhood, deleted_orphans).
    """
    # Primary lookup: vibe_neighborhoods flat collection (populated by the
    # batch/enrichment pipeline, covers ~1,780 neighborhoods).
    print("Building neighborhood → city_id map from vibe_neighborhoods...")
    nbhd_to_city: dict[str, str] = {}
    for doc in db.collection("vibe_neighborhoods").stream():
        d = doc.to_dict()
        city_id = d.get("city_id")
        if city_id:
            nbhd_to_city[doc.id] = city_id
    print(f"  {len(nbhd_to_city)} neighborhoods indexed from vibe_neighborhoods")

    # Secondary lookup: collection group query on the nested neighborhoods
    # subcollection (cities/{cityId}/neighborhoods/{neighborhoodId}). Covers
    # neighborhoods from original pipeline runs that never populated
    # vibe_neighborhoods. City ID is extracted from the document path.
    print("Supplementing with nested neighborhoods (collection group query)...")
    extra = 0
    for doc in db.collection_group("neighborhoods").stream():
        nbhd_id = doc.id
        if nbhd_id not in nbhd_to_city:
            # Path: .../cities/{cityId}/neighborhoods/{neighborhoodId}
            parts = doc.reference.path.split("/")
            # parts: ['cities', cityId, 'neighborhoods', neighborhoodId]
            if len(parts) >= 4 and parts[0] == "cities" and parts[2] == "neighborhoods":
                city_id = parts[1]
                nbhd_to_city[nbhd_id] = city_id
                extra += 1
    print(f"  {extra} additional neighborhoods indexed from nested subcollections")
    print(f"  Total: {len(nbhd_to_city)} neighborhoods")

    # Stream vibe_tasks and batch-write city_id where missing.
    updated = 0
    skipped_has_city = 0
    orphaned_nbhd_ids: set[str] = set()
    orphaned_task_refs = []

    batch = db.batch()
    batch_count = 0

    for doc in db.collection("vibe_tasks").stream():
        d = doc.to_dict()

        if "city_id" in d:
            skipped_has_city += 1
            continue

        nbhd_id = d.get("neighborhood_id")
        city_id = nbhd_to_city.get(nbhd_id) if nbhd_id else None

        if not city_id:
            # Neighborhood doesn't exist in Firestore — task is orphaned.
            if nbhd_id:
                orphaned_nbhd_ids.add(nbhd_id)
            orphaned_task_refs.append(doc.reference)
            continue

        if dry_run:
            print(f"  would set {doc.id}.city_id = {city_id!r}")
        else:
            batch.update(doc.reference, {"city_id": city_id})
            batch_count += 1
            if batch_count >= BATCH_SIZE:
                batch.commit()
                print(f"  committed batch of {batch_count}")
                batch = db.batch()
                batch_count = 0
        updated += 1

    if not dry_run and batch_count > 0:
        batch.commit()
        print(f"  committed final batch of {batch_count}")

    # Report orphaned tasks.
    if orphaned_task_refs:
        print(f"\n  Orphaned tasks: {len(orphaned_task_refs)} tasks reference neighborhoods")
        print(f"  that no longer exist in Firestore ({len(orphaned_nbhd_ids)} unique neighborhood IDs):")
        for nbhd_id in sorted(orphaned_nbhd_ids):
            print(f"    {nbhd_id}")

    # Optionally delete orphaned tasks.
    deleted_orphans = 0
    if orphaned_task_refs and delete_orphans:
        print(f"\n  {'Would delete' if dry_run else 'Deleting'} {len(orphaned_task_refs)} orphaned tasks...")
        if not dry_run:
            orphan_batch = db.batch()
            orphan_count = 0
            for ref in orphaned_task_refs:
                orphan_batch.delete(ref)
                orphan_count += 1
                if orphan_count >= BATCH_SIZE:
                    orphan_batch.commit()
                    orphan_batch = db.batch()
                    orphan_count = 0
            if orphan_count > 0:
                orphan_batch.commit()
        deleted_orphans = len(orphaned_task_refs)

    return updated, skipped_has_city, len(orphaned_task_refs), deleted_orphans


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", action="store_true", help="Execute writes (default is dry-run)")
    parser.add_argument("--delete-orphans", action="store_true", help="Delete vibe_tasks docs whose neighborhood no longer exists in Firestore")
    args = parser.parse_args()

    dry_run = not args.run
    if dry_run:
        print("DRY RUN — no writes will occur. Pass --run to execute.\n")
    else:
        print("LIVE RUN — writing to Firestore urbanexplorer database.\n")

    db = firestore.Client(project=GCP_PROJECT, database=DATABASE)

    # 1. Delete orphan city docs
    print(f"=== Step 1: Delete {len(ORPHAN_CITY_IDS)} orphan city docs ===")
    for city_id in sorted(ORPHAN_CITY_IDS):
        print(f"\nDeleting orphan: {city_id}")
        n = delete_city_and_subcollections(db, city_id, dry_run)
        print(f"  → {n} documents {'would be ' if dry_run else ''}deleted")

    # 2. Delete duplicate city docs
    print(f"\n=== Step 2: Delete {len(DUPLICATE_CITY_IDS)} duplicate city docs ===")
    for city_id in sorted(DUPLICATE_CITY_IDS):
        print(f"\nDeleting duplicate: {city_id}")
        n = delete_city_and_subcollections(db, city_id, dry_run)
        print(f"  → {n} documents {'would be ' if dry_run else ''}deleted")

    # 3. Backfill city_id on vibe_tasks
    print("\n=== Step 3: Backfill city_id on vibe_tasks ===")
    updated, has_city, orphaned, deleted_orphans = backfill_task_city_ids(
        db, dry_run, delete_orphans=args.delete_orphans
    )
    print(f"\nResults:")
    print(f"  {'Would update' if dry_run else 'Updated'}:          {updated} tasks")
    print(f"  Already had city_id:  {has_city} tasks")
    print(f"  Orphaned (no neighborhood): {orphaned} tasks")
    if args.delete_orphans:
        print(f"  {'Would delete' if dry_run else 'Deleted'} orphans: {deleted_orphans} tasks")

    if dry_run:
        print("\nRe-run with --run to apply changes.")
    else:
        print("\nDone. Verify with:")
        print("  python3.12 -c \"from google.cloud import firestore; db=firestore.Client(project='urban-explorer-483600',database='urbanexplorer'); t=list(db.collection('vibe_tasks').limit(3).stream()); [print(d.id, d.to_dict().get('city_id')) for d in t]\"")


if __name__ == "__main__":
    main()
