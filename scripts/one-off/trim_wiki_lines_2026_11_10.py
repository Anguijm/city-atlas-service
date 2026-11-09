"""U49, 2026-11-10: trim the Wikipedia lines already in Firestore.

wiki_describe.trim_lead now trims new Wikipedia sentences as they are
written. The five written by U48 (2026-10-11) are already in Firestore, and
the saved research JSON that describe-only would re-run from lives on the
laptop, untracked. This applies the same trim to the live documents
directly, for the towns that have an OSM listing (data/osm/<id>.md), the
only towns wiki_describe ever describes.

Only `description.en` changes, in both copies ingest writes
(vibe_waypoints/<id> and cities/<city>/neighborhoods/<nb>/waypoints/<id>,
build_cache.ts). Other locales, if any, are reported, not touched.

Dry run by default; --apply writes. Auth: Application Default Credentials.

  .venv/bin/python scripts/one-off/trim_wiki_lines_2026_11_10.py [--apply]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "pipeline"))
from wiki_describe import trim_lead  # noqa: E402

PROJECT = "urban-explorer-483600"
DATABASE = "urbanexplorer"


def main() -> None:
    from google.cloud import firestore

    apply = "--apply" in sys.argv
    cache = json.loads((ROOT / "configs" / "global_city_cache.json").read_text())
    cities = cache if isinstance(cache, list) else cache.get("cities", cache)
    towns = {c["id"]: c for c in cities if (ROOT / "data" / "osm" / f"{c['id']}.md").exists()}
    db = firestore.Client(project=PROJECT, database=DATABASE)
    changes = 0
    for cid, city in sorted(towns.items()):
        place = city.get("clinicalName", "")
        for doc in db.collection("vibe_waypoints").where(filter=firestore.FieldFilter("city_id", "==", cid)).stream():
            v = doc.to_dict()
            desc = v.get("description") or {}
            name = v.get("name") or {}
            en, nm = (desc.get("en") or ""), (name.get("en") or "")
            if not en or not nm:
                continue
            new = trim_lead(en, nm, nm, place)
            if new == en:
                continue
            changes += 1
            others = sorted(k for k in desc if k != "en")
            print(f"{cid} | {nm}\n  before: {en}\n  after:  {new}" + (f"\n  other locales left as they are: {others}" if others else ""))
            if apply:
                sub = (db.collection("cities").document(cid).collection("neighborhoods")
                       .document(v["neighborhood_id"]).collection("waypoints").document(doc.id))
                batch = db.batch()
                batch.update(doc.reference, {"description.en": new})
                if sub.get().exists:
                    batch.update(sub, {"description.en": new})
                else:
                    print("  (no subcollection copy)")
                batch.commit()
                print("  written")
    print(f"{changes} line(s) {'written' if apply else 'would change (dry run)'} across {len(towns)} OSM towns")


if __name__ == "__main__":
    main()
