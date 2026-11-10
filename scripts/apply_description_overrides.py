"""Write the approved plain-word place lines to the live atlas (U51).

data/description-overrides.json holds lines John approved, keyed by
waypoint id. Ingest (writeCityToFirestore) applies them on every pipeline
run; this applies them to Firestore now, without a pipeline run. It sets
`description` to {"en": line} in both copies ingest writes
(vibe_waypoints/<id> and cities/<city>/neighborhoods/<nb>/waypoints/<id>),
dropping translations of the old line, as ingest does.

Dry run by default; --apply writes. Auth: Application Default Credentials;
on the MS-S1 set GOOGLE_CLOUD_QUOTA_PROJECT=urban-explorer-483600.

  .venv/bin/python scripts/apply_description_overrides.py [--apply]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "urban-explorer-483600"
DATABASE = "urbanexplorer"
MAX_CHARS = 240  # description_overrides.ts MAX_OVERRIDE_CHARS; keep equal


def load() -> dict[str, str]:
    raw = json.loads((ROOT / "data" / "description-overrides.json").read_text())
    out = {}
    for wid, v in raw.items():
        if wid.startswith("_"):
            continue
        line = (v.get("line") or "").strip()
        if not line or not v.get("source") or not v.get("approved") or len(line) > MAX_CHARS:
            raise SystemExit(f"override {wid}: needs line (at most {MAX_CHARS}), source and approved")
        out[wid] = line
    return out


def main() -> None:
    from google.cloud import firestore

    apply = "--apply" in sys.argv
    db = firestore.Client(project=PROJECT, database=DATABASE)
    changed = missing = 0
    for wid, line in load().items():
        ref = db.collection("vibe_waypoints").document(wid)
        snap = ref.get()
        if not snap.exists:
            missing += 1
            print(f"MISSING {wid}")
            continue
        v = snap.to_dict()
        now = (v.get("description") or {}).get("en")
        if now == line and set((v.get("description") or {}).keys()) == {"en"}:
            print(f"same    {wid}")
            continue
        changed += 1
        print(f"{wid}\n  before: {now}\n  after:  {line}")
        if apply:
            batch = db.batch()
            batch.update(ref, {"description": {"en": line}})
            nb, city = v.get("neighborhood_id"), v.get("city_id")
            sub = (db.collection("cities").document(city).collection("neighborhoods").document(nb)
                   .collection("waypoints").document(wid)) if nb and city else None
            if sub is not None and sub.get().exists:
                batch.update(sub, {"description": {"en": line}})
            else:
                print("  (no subcollection copy)")
            batch.commit()
            print("  written")
    print(f"{changed} {'written' if apply else 'would change (dry run)'}, {missing} missing")
    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
