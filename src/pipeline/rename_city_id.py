"""Rename a city document and all its associated data in Firestore.

Renames city docs, all nested subcollections, and all flat vibe_ collection
entries from old_id to new_id. Required when the canonical city ID changes
(e.g. "birmingham" → "birmingham-al" for naming-convention alignment).

Operations in order:
  1. Copy cities/{old_id} doc + all nested neighborhoods/waypoints/tasks
     to cities/{new_id}.
  2. Copy all vibe_neighborhoods, vibe_waypoints, vibe_tasks docs where
     city_id == old_id, updating the city_id field and any ID-embedded
     references.
  3. Delete all old_id docs (old cities/{old_id} tree + old flat entries).

NOTE: This script does NOT re-run the pipeline — the research output JSON
and scrape data files must be renamed separately (see rename instructions
in the commit message). After running this, re-run research_city.py for
the renamed city to re-ingest under the new ID.

Usage:
    python3.12 src/pipeline/rename_city_id.py --old birmingham --new birmingham-al
    python3.12 src/pipeline/rename_city_id.py --old birmingham --new birmingham-al --run
"""

import argparse
from google.cloud import firestore

GCP_PROJECT = "urban-explorer-483600"
DATABASE = "urbanexplorer"
BATCH_SIZE = 400


def copy_doc(batch, src_ref, dst_ref, field_overrides: dict = None, dry_run: bool = True) -> None:
    """Copy a Firestore doc to a new reference, with optional field overrides."""
    data = src_ref.get().to_dict()
    if not data:
        return
    if field_overrides:
        data.update(field_overrides)
    if dry_run:
        print(f"  would copy {src_ref.path} → {dst_ref.path}")
    else:
        batch.set(dst_ref, data)


def rename_city(db: firestore.Client, old_id: str, new_id: str, dry_run: bool) -> None:
    old_city_ref = db.collection("cities").document(old_id)
    new_city_ref = db.collection("cities").document(new_id)

    # --- Step 1: Copy nested city tree ---
    print(f"\n=== Step 1: Copy cities/{old_id} → cities/{new_id} ===")

    # Copy city doc itself
    city_data = old_city_ref.get().to_dict()
    if city_data:
        if "id" in city_data:
            city_data["id"] = new_id
        print(f"  {'would copy' if dry_run else 'copying'} cities/{old_id} → cities/{new_id}")
        if not dry_run:
            new_city_ref.set(city_data)

    # Walk neighborhoods → waypoints/tasks
    for nbhd in old_city_ref.collection("neighborhoods").stream():
        new_nbhd_ref = new_city_ref.collection("neighborhoods").document(nbhd.id)
        nbhd_data = nbhd.to_dict()
        if nbhd_data and "city_id" in nbhd_data:
            nbhd_data["city_id"] = new_id
        print(f"  {'would copy' if dry_run else 'copying'} neighborhoods/{nbhd.id}")
        if not dry_run:
            new_nbhd_ref.set(nbhd_data or {})

        for sub in ("waypoints", "tasks"):
            for doc in old_city_ref.collection("neighborhoods").document(nbhd.id).collection(sub).stream():
                new_doc_ref = new_nbhd_ref.collection(sub).document(doc.id)
                doc_data = doc.to_dict()
                if doc_data and "city_id" in doc_data:
                    doc_data["city_id"] = new_id
                print(f"    {'would copy' if dry_run else 'copying'} {sub}/{doc.id}")
                if not dry_run:
                    new_doc_ref.set(doc_data or {})

    # --- Step 2: Copy flat vibe_ collections ---
    print(f"\n=== Step 2: Copy flat vibe_ entries with city_id={old_id!r} → {new_id!r} ===")

    batch = db.batch()
    batch_count = 0

    for collection in ("vibe_neighborhoods", "vibe_waypoints", "vibe_tasks"):
        query = db.collection(collection).where(filter=firestore.FieldFilter("city_id", "==", old_id))
        docs = list(query.stream())
        print(f"  {collection}: {len(docs)} docs")
        for doc in docs:
            data = doc.to_dict()
            data["city_id"] = new_id
            new_ref = db.collection(collection).document(doc.id)
            print(f"    {'would update' if dry_run else 'updating'} {collection}/{doc.id}")
            if not dry_run:
                batch.set(new_ref, data)
                batch_count += 1
                if batch_count >= BATCH_SIZE:
                    batch.commit()
                    print(f"    committed batch of {batch_count}")
                    batch = db.batch()
                    batch_count = 0

    if not dry_run and batch_count > 0:
        batch.commit()
        print(f"  committed final batch of {batch_count}")

    # --- Step 3: Delete old docs ---
    print(f"\n=== Step 3: Delete old cities/{old_id} tree + flat entries ===")

    # Delete nested city tree
    for nbhd in old_city_ref.collection("neighborhoods").stream():
        for sub in ("waypoints", "tasks"):
            for doc in old_city_ref.collection("neighborhoods").document(nbhd.id).collection(sub).stream():
                print(f"  {'would delete' if dry_run else 'deleting'} cities/{old_id}/neighborhoods/{nbhd.id}/{sub}/{doc.id}")
                if not dry_run:
                    doc.reference.delete()
        print(f"  {'would delete' if dry_run else 'deleting'} cities/{old_id}/neighborhoods/{nbhd.id}")
        if not dry_run:
            nbhd.reference.delete()

    print(f"  {'would delete' if dry_run else 'deleting'} cities/{old_id}")
    if not dry_run:
        old_city_ref.delete()

    # Delete old flat entries
    for collection in ("vibe_neighborhoods", "vibe_waypoints", "vibe_tasks"):
        query = db.collection(collection).where(filter=firestore.FieldFilter("city_id", "==", old_id))
        for doc in query.stream():
            print(f"  {'would delete' if dry_run else 'deleting'} {collection}/{doc.id}")
            if not dry_run:
                doc.reference.delete()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--old", required=True, help="Current city ID to rename from")
    parser.add_argument("--new", required=True, help="New city ID to rename to")
    parser.add_argument("--run", action="store_true", help="Execute writes (default is dry-run)")
    args = parser.parse_args()

    dry_run = not args.run
    if dry_run:
        print(f"DRY RUN: {args.old!r} → {args.new!r} — pass --run to execute\n")
    else:
        print(f"LIVE RUN: renaming {args.old!r} → {args.new!r} in Firestore urbanexplorer\n")

    db = firestore.Client(project=GCP_PROJECT, database=DATABASE)
    rename_city(db, args.old, args.new, dry_run)

    if dry_run:
        print("\nRe-run with --run to apply changes.")
    else:
        print(f"\nDone. Verify: check cities/{args.new} exists and cities/{args.old} is gone.")
        print(f"Then re-run: python3.12 src/pipeline/research_city.py --city {args.new} --ingest --force")


if __name__ == "__main__":
    main()
