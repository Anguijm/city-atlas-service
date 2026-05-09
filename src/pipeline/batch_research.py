#!/usr/bin/env python3.12
"""
Batch Research Pipeline — Respectful Loading for Urban Explorer

Wraps research-city.py for multi-city processing with rate limiting,
observability, and error recovery.

Usage:
  # Preview what would be researched
  python3.12 src/pipeline/batch_research.py --tier tier2 --tier tier3 --dry-run

  # Load all 80 cities, 1 per hour, with Firestore ingestion
  python3.12 src/pipeline/batch_research.py --tier tier2 --tier tier3 --interval 3600 --ingest

  # Resume after interruption
  python3.12 src/pipeline/batch_research.py --resume --interval 3600 --ingest

  # Specific cities
  python3.12 src/pipeline/batch_research.py --cities "taipei,shanghai" --interval 3600
"""

import argparse
import json
import os
import sys
import time

# Force unbuffered stdout so tee captures output in real-time
sys.stdout.reconfigure(line_buffering=True)
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline_utils import CITY_ID_RE, check_branch_guard

# Paths — file is at src/pipeline/batch_research.py, repo root is two levels up
PROJECT_ROOT = Path(__file__).parent.parent.parent
CITY_CACHE = PROJECT_ROOT / "configs" / "global_city_cache.json"
OUTPUT_DIR = PROJECT_ROOT / "data" / "research-output"
MANIFEST_PATH = OUTPUT_DIR / "batch-manifest.json"

# Defaults
DEFAULT_INTERVAL_SECONDS = 60
MAX_CONSECUTIVE_FAILURES = 10

# Estimated costs (NotebookLM research is free via Google account auth;
# Gemini Flash structuring is ~$0.03/city; Firestore writes negligible)
EST_GEMINI_COST_PER_CITY = 0.03  # USD


def load_cities(tiers: list[str] | None = None, city_ids: list[str] | None = None) -> list[dict]:
    """Load cities from global_city_cache.json, optionally filtered."""
    with open(CITY_CACHE) as f:
        cities = json.load(f)

    if city_ids:
        id_set = set(city_ids)
        return [c for c in cities if c["id"] in id_set]

    if tiers:
        return [c for c in cities if c.get("tier") in tiers]

    return cities


def load_manifest() -> dict:
    """Load the batch manifest, or return empty structure."""
    if MANIFEST_PATH.exists():
        with open(MANIFEST_PATH) as f:
            return json.load(f)
    return {"started": None, "tiers": None, "interval_s": None, "cities": [], "completed": 0, "failed": 0, "pending": 0}


def save_manifest(manifest: dict) -> None:
    """Save the batch manifest."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, default=str)


def get_demand_ordering() -> dict[str, int]:
    """
    Query Firestore pending_research collection for demand-based ordering.
    Falls back to empty dict if Firestore is unavailable.
    """
    try:
        creds_path = os.path.expanduser("~/.config/gcloud/application_default_credentials.json")
        if not os.path.exists(creds_path):
            print("  ℹ No ADC credentials found — skipping demand ordering")
            return {}

        os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", creds_path)
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "urban-explorer-483600")

        from google.cloud import firestore  # type: ignore

        db = firestore.Client(database="urbanexplorer")
        docs = db.collection("pending_research").order_by("count", direction=firestore.Query.DESCENDING).stream()
        return {doc.id: doc.to_dict().get("count", 0) for doc in docs}
    except Exception as e:
        print(f"  ⚠ Could not query demand data: {e}")
        return {}


def sort_by_demand(cities: list[dict], demand: dict[str, int]) -> list[dict]:
    """Sort cities by demand count (highest first), then alphabetically."""
    return sorted(cities, key=lambda c: (-demand.get(c["id"], 0), c["id"]))


def get_completed_cities() -> set[str]:
    """Check which cities already have research output JSON."""
    completed = set()
    if OUTPUT_DIR.exists():
        for f in OUTPUT_DIR.glob("*.json"):
            if f.name != "batch-manifest.json":
                completed.add(f.stem)
    return completed


def scrape_atlas_if_needed(city_id: str) -> None:
    """Pre-scrape Atlas Obscura data if not already cached."""
    atlas_dir = PROJECT_ROOT / "data" / "atlas-obscura"
    atlas_file = atlas_dir / f"{city_id}.md"
    if atlas_file.exists():
        return
    print(f"  → Scraping Atlas Obscura for {city_id}...")
    try:
        result = subprocess.run(
            ["npx", "tsx", str(PROJECT_ROOT / "src" / "scrapers" / "atlas-obscura.ts"),
             "--city", city_id],
            capture_output=True, text=True, timeout=120, cwd=str(PROJECT_ROOT)
        )
        if result.returncode == 0 and atlas_file.exists():
            print(f"  ✓ Atlas Obscura data cached")
        else:
            print(f"  ⚠ Atlas scrape returned no data (non-fatal)")
    except Exception as e:
        print(f"  ⚠ Atlas scrape failed (non-fatal): {e}")


# Spotted by Locals was retired 2026-04-26 (PR #15, closes issue #11). Manual
# audit across all ~215 scraped cities found uniform ~9–10 KB .md files
# dominated by template/menu chrome, not the resident-written recommendations
# the source advertises. The signal-to-noise ratio was effectively zero;
# Reddit + The Infatuation now cover the resident-recommendation slot.
LOCAL_SOURCES = ["the-infatuation", "timeout", "locationscout"]


def scrape_local_source_if_needed(city_id: str, source: str) -> None:
    """Pre-scrape a local recommendation source if not already cached."""
    source_dir = PROJECT_ROOT / "data" / source
    source_file = source_dir / f"{city_id}.md"
    if source_file.exists():
        return
    print(f"  → Scraping {source} for {city_id}...")
    try:
        result = subprocess.run(
            ["npx", "tsx", str(PROJECT_ROOT / "src" / "scrapers" / "local-sources.ts"),
             "--source", source, "--city", city_id],
            capture_output=True, text=True, timeout=120, cwd=str(PROJECT_ROOT)
        )
        if result.returncode == 0 and source_file.exists():
            print(f"  ✓ {source} data cached")
        else:
            print(f"  ⚠ {source} scrape returned no data (non-fatal)")
    except Exception as e:
        print(f"  ⚠ {source} scrape failed (non-fatal): {e}")


def scrape_wikipedia_if_needed(city_id: str) -> None:
    """Pre-scrape Wikipedia article if not already cached."""
    wiki_file = PROJECT_ROOT / "data" / "wikipedia" / f"{city_id}.md"
    if wiki_file.exists():
        return
    print(f"  → Scraping Wikipedia for {city_id}...")
    try:
        result = subprocess.run(
            ["npx", "tsx", str(PROJECT_ROOT / "src" / "scrapers" / "wikipedia.ts"),
             "--city", city_id],
            capture_output=True, text=True, timeout=180, cwd=str(PROJECT_ROOT)
        )
        if result.returncode == 0 and wiki_file.exists():
            print(f"  ✓ Wikipedia data cached")
        else:
            print(f"  ⚠ Wikipedia scrape returned no data (non-fatal)")
    except Exception as e:
        print(f"  ⚠ Wikipedia scrape failed (non-fatal): {e}")


# Reddit's unauthenticated API is the most rate-limit-sensitive source (tighter
# than Wikipedia's 1 req/sec). We hard-cap Reddit scrape invocations per batch
# to mitigate IP-ban risk — overridable via HARNESS_REDDIT_BATCH_CAP env var.
# At ~10 API calls per city (6 searches + up to 5 post threads + throttled
# delays), 50 cities = ~500 calls, which fits comfortably within a single
# batch. Cap stops new reddit scrapes once reached; cached cities still load.
REDDIT_BATCH_CAP = int(os.environ.get("HARNESS_REDDIT_BATCH_CAP", "60"))
_reddit_calls_this_batch = 0


def scrape_reddit_if_needed(city_id: str) -> None:
    """Pre-scrape Reddit threads if not already cached. Respects REDDIT_BATCH_CAP."""
    global _reddit_calls_this_batch
    reddit_file = PROJECT_ROOT / "data" / "reddit" / f"{city_id}.md"
    if reddit_file.exists():
        return  # cached; no API call needed, no budget consumed
    if _reddit_calls_this_batch >= REDDIT_BATCH_CAP:
        print(f"  ⚠ Reddit batch cap reached ({REDDIT_BATCH_CAP}); skipping {city_id} (non-fatal)")
        return
    _reddit_calls_this_batch += 1
    print(f"  → Scraping Reddit for {city_id}... ({_reddit_calls_this_batch}/{REDDIT_BATCH_CAP})")
    try:
        result = subprocess.run(
            ["npx", "tsx", str(PROJECT_ROOT / "src" / "scrapers" / "reddit.ts"),
             "--city", city_id],
            capture_output=True, text=True, timeout=300, cwd=str(PROJECT_ROOT)
        )
        if result.returncode == 0 and reddit_file.exists():
            print(f"  ✓ Reddit data cached")
        else:
            print(f"  ⚠ Reddit scrape returned no data (non-fatal)")
    except Exception as e:
        print(f"  ⚠ Reddit scrape failed (non-fatal): {e}")


def run_city_research(city_id: str, ingest: bool = False, mode: str = "notebooklm", enrich: bool = False) -> dict:
    """Run research-city.py for a single city. Returns status dict."""
    # Pre-scrape all content sources (no-op if files already exist)
    scrape_atlas_if_needed(city_id)
    for source in LOCAL_SOURCES:
        scrape_local_source_if_needed(city_id, source)
    scrape_wikipedia_if_needed(city_id)
    scrape_reddit_if_needed(city_id)

    started_at = datetime.now(timezone.utc).isoformat()
    start = time.time()
    cmd = [
        sys.executable, str(PROJECT_ROOT / "src" / "pipeline" / "research_city.py"),
        "--city", city_id,
        "--mode", mode,
    ]
    if ingest:
        cmd.append("--ingest")
    if enrich:
        cmd.append("--enrich")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)  # 60 min max
        duration = time.time() - start

        if result.returncode != 0:
            return {
                "id": city_id,
                "status": "failed",
                "started_at": started_at,
                "error": result.stderr[-500:] if result.stderr else f"Exit code {result.returncode}",
                "duration_s": round(duration),
            }

        # Parse output for counts
        output = result.stdout
        neighborhoods = _extract_count(output, "neighborhoods")
        waypoints = _extract_count(output, "waypoints")
        tasks = _extract_count(output, "tasks")

        return {
            "id": city_id,
            "status": "completed",
            "started_at": started_at,
            "duration_s": round(duration),
            "neighborhoods": neighborhoods,
            "waypoints": waypoints,
            "tasks": tasks,
        }

    except subprocess.TimeoutExpired:
        return {
            "id": city_id,
            "status": "failed",
            "started_at": started_at,
            "error": "Timeout (30 min)",
            "duration_s": 1800,
        }
    except Exception as e:
        return {
            "id": city_id,
            "status": "failed",
            "started_at": started_at,
            "error": str(e),
            "duration_s": round(time.time() - start),
        }


def _extract_count(output: str, key: str) -> int:
    """Extract a count from pipeline output like '6 neighborhoods'."""
    match = re.search(rf"(\d+)\s+{key}", output)
    return int(match.group(1)) if match else 0


def format_duration(seconds: int) -> str:
    """Format seconds as human-readable duration."""
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m {seconds % 60}s"
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    return f"{hours}h {minutes}m"


def print_summary(manifest: dict) -> None:
    """Print a summary table of the batch run."""
    print(f"\n{'='*60}")
    print("BATCH RESEARCH SUMMARY")
    print(f"{'='*60}")

    completed = [c for c in manifest["cities"] if c["status"] == "completed"]
    failed = [c for c in manifest["cities"] if c["status"] == "failed"]
    pending = [c for c in manifest["cities"] if c["status"] == "pending"]

    total_duration = sum(c.get("duration_s") or 0 for c in manifest["cities"] if c["status"] != "pending")
    total_waypoints = sum(c.get("waypoints") or 0 for c in completed)
    total_tasks = sum(c.get("tasks") or 0 for c in completed)

    print(f"  Completed: {len(completed)}")
    print(f"  Failed:    {len(failed)}")
    print(f"  Pending:   {len(pending)}")
    print(f"  Duration:  {format_duration(total_duration)}")
    print(f"  Waypoints: {total_waypoints}")
    print(f"  Tasks:     {total_tasks}")

    if failed:
        print("\n  FAILURES:")
        for c in failed:
            print(f"    {c['id']}: {c.get('error', 'unknown')}")

    if pending:
        print(f"\n  REMAINING ({len(pending)}):")
        for c in pending[:10]:
            print(f"    {c['id']}")
        if len(pending) > 10:
            print(f"    ... and {len(pending) - 10} more")

    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Batch research cities via NotebookLM + Gemini",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Preview tier-2 + tier-3 cities
  %(prog)s --tier tier2 --tier tier3 --dry-run

  # Run all 80 cities at 1/hour with ingestion (use in tmux)
  %(prog)s --tier tier2 --tier tier3 --interval 3600 --ingest

  # Resume after interruption
  %(prog)s --resume --interval 3600 --ingest
""",
    )
    parser.add_argument("--tier", action="append", choices=["tier1", "tier2", "tier3"], help="Filter by tier (repeatable: --tier tier2 --tier tier3)")
    parser.add_argument("--cities", type=str, help="Comma-separated city IDs")
    parser.add_argument("--batch-size", type=int, default=0, help="Max cities per run (default: all)")
    parser.add_argument("--no-limit", action="store_true", help="Bypass the 25-city safety ceiling for large batch runs")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS, help=f"Seconds between city starts (default: {DEFAULT_INTERVAL_SECONDS}). Use 3600 for 1/hour.")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without executing")
    parser.add_argument("--resume", action="store_true", help="Resume from batch-manifest.json")
    parser.add_argument("--ingest", action="store_true", help="Also ingest to Firestore after research")
    parser.add_argument("--force", action="store_true", help="Re-research cities even if they already have output (enrichment run)")
    parser.add_argument("--enrich", action="store_true", help="Enrich existing cities with new waypoints (additive, no overwrite)")
    parser.add_argument("--mode", choices=["notebooklm", "gemini", "claude"],
                        default="notebooklm",
                        help="Research backend (passed through to research-city.py)")
    args = parser.parse_args()

    # Branch-guard preflight: abort if main has an unreviewed direct push.
    # Only relevant for runs that write to Firestore; dry-runs are read-only.
    if args.ingest and not args.dry_run:
        check_branch_guard()

    interval = args.interval

    # Determine city list
    if args.resume:
        manifest = load_manifest()
        if not manifest["cities"]:
            print("ERROR: No manifest found. Run without --resume first.")
            sys.exit(1)
        # Skip persistently-failed cities (2+ attempts) before building the city list
        for entry in manifest["cities"]:
            if entry["status"] == "failed":
                retry_count = entry.get("retry_count", 0) + 1
                entry["retry_count"] = retry_count
                if retry_count >= 2:
                    entry["status"] = "skipped"
                    print(f"⚠ Skipping {entry['id']} (failed {retry_count} times)")
        save_manifest(manifest)
        # Filter to pending + failed (excludes "skipped" and "completed"), failed retries at end
        pending_ids = [c["id"] for c in manifest["cities"] if c["status"] == "pending"]
        failed_ids = [c["id"] for c in manifest["cities"] if c["status"] == "failed"]
        city_ids = pending_ids + failed_ids
        cities = load_cities(city_ids=city_ids)
        # Preserve ordering: pending first, failed retries at the end
        pending_set = set(pending_ids)
        cities_pending = [c for c in cities if c["id"] in pending_set]
        cities_failed = [c for c in cities if c["id"] not in pending_set]
        cities = cities_pending + cities_failed
        if failed_ids:
            print(f"Resuming: {len(pending_ids)} pending + {len(failed_ids)} retries (moved to end)")
        else:
            print(f"Resuming: {len(city_ids)} cities remaining from previous run")
    else:
        if args.cities:
            city_ids_arg = [cid.strip() for cid in args.cities.split(",")]
            invalid = [cid for cid in city_ids_arg if not CITY_ID_RE.match(cid)]
            if invalid:
                print(f"ERROR: Invalid city ID(s): {', '.join(repr(c) for c in invalid)}")
                print("  City IDs must match [a-z0-9-]+ (e.g. 'new-york-city', 'birmingham-al')")
                sys.exit(1)
        else:
            city_ids_arg = None
        cities = load_cities(tiers=args.tier, city_ids=city_ids_arg)

    if not cities:
        print("ERROR: No cities matched the filter.")
        sys.exit(1)

    # Skip already-completed cities (have JSON output) unless --force or --enrich
    completed = get_completed_cities()
    if not args.resume and not args.force and not args.enrich:
        skipped = [c for c in cities if c["id"] in completed]
        cities = [c for c in cities if c["id"] not in completed]
        if skipped:
            print(f"Skipping {len(skipped)} cities with existing output: {', '.join(c['id'] for c in skipped[:5])}{'...' if len(skipped) > 5 else ''}")
    elif args.enrich:
        print(f"ENRICHMENT MODE: enriching {len(cities)} cities with new waypoints (--enrich, additive)")
    elif args.force:
        print(f"ENRICHMENT MODE: re-researching all {len(cities)} cities (--force)")

    # Demand-based ordering
    print("→ Checking demand ordering from discovery queue...")
    demand = get_demand_ordering()
    cities = sort_by_demand(cities, demand)

    # Circuit breaker: prevent accidental large runs that blow the cost budget.
    # Dry runs are exempt (no API calls). Pass --no-limit to override for intentional large batches.
    BATCH_SAFETY_LIMIT = 25
    if not args.dry_run and not args.no_limit and len(cities) > BATCH_SAFETY_LIMIT:
        print(
            f"ERROR: batch would process {len(cities)} cities (safety limit: {BATCH_SAFETY_LIMIT}).\n"
            f"  Pass --no-limit to run a batch of this size intentionally, or use --batch-size to cap it.\n"
            f"  Tip: --dry-run first to preview the full list without triggering this check.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Apply batch size (0 = all)
    if args.batch_size > 0:
        batch = cities[:args.batch_size]
        remaining = cities[args.batch_size:]
    else:
        batch = cities
        remaining = []

    # Dry run
    if args.dry_run:
        est_hours = len(batch) * interval / 3600
        est_cost = len(batch) * EST_GEMINI_COST_PER_CITY
        tier_str = f" ({', '.join(args.tier)})" if args.tier else ""
        enrich_str = " [ENRICHMENT MODE]" if args.enrich else ""
        print(f"\nDRY RUN: Would research {len(batch)} cities{tier_str}{enrich_str}")
        print(f"Interval: {format_duration(interval)} between cities\n")
        for i, c in enumerate(batch, 1):
            demand_count = demand.get(c["id"], 0)
            demand_str = f" (demand: {demand_count})" if demand_count > 0 else ""
            print(f"  {i:3}. {c['id']:<20} — {c['name']}, {c['country']}{demand_str}")

        eta = datetime.now(timezone.utc) + timedelta(seconds=len(batch) * interval)
        print(f"\nEstimated: ~{est_hours:.1f} hours ({est_hours / 24:.1f} days), ~${est_cost:.2f} Gemini API cost, {len(batch) * 2} NotebookLM queries")
        print(f"ETA: {eta.strftime('%Y-%m-%d %H:%M UTC')}")
        if remaining:
            print(f"Remaining after this batch: {len(remaining)} cities")
        return

    # Build or update manifest
    if args.resume:
        manifest = load_manifest()
        # Recalculate all counts from source of truth (skip logic handled above)
        manifest["completed"] = sum(1 for c in manifest["cities"] if c["status"] == "completed")
        manifest["failed"] = sum(1 for c in manifest["cities"] if c["status"] == "failed")
        manifest["skipped"] = sum(1 for c in manifest["cities"] if c["status"] == "skipped")
        manifest["pending"] = sum(1 for c in manifest["cities"] if c["status"] == "pending")
    else:
        manifest = {
            "started": datetime.now(timezone.utc).isoformat(),
            "tiers": args.tier,
            "interval_s": interval,
            "cities": [{"id": c["id"], "status": "pending"} for c in batch],
            "completed": 0,
            "failed": 0,
            "pending": len(batch),
        }
    save_manifest(manifest)

    # Execute
    consecutive_failures = 0
    for i, city in enumerate(batch):
        city_id = city["id"]
        city_start = time.time()
        cities_remaining = len(batch) - i - 1

        print(f"\n[{i+1}/{len(batch)}] Researching {city_id} ({city['name']}, {city['country']})...")

        result = run_city_research(city_id, ingest=args.ingest, mode=args.mode, enrich=args.enrich)

        # Update manifest
        for entry in manifest["cities"]:
            if entry["id"] == city_id:
                entry.update(result)
                break

        if result["status"] == "completed":
            consecutive_failures = 0
            print(f"  ✓ {city_id}: OK ({result['duration_s']}s, {result.get('neighborhoods', '?')} nh, {result.get('waypoints', '?')} wp, {result.get('tasks', '?')} tasks)")
        else:
            consecutive_failures += 1
            print(f"  ✗ {city_id}: FAILED — {result.get('error', 'unknown')}")

        # Recalculate totals from source of truth (avoids double-counting on retries)
        manifest["completed"] = sum(1 for c in manifest["cities"] if c["status"] == "completed")
        manifest["failed"] = sum(1 for c in manifest["cities"] if c["status"] == "failed")
        manifest["skipped"] = sum(1 for c in manifest["cities"] if c["status"] == "skipped")
        manifest["pending"] = sum(1 for c in manifest["cities"] if c["status"] == "pending")

        save_manifest(manifest)

        # Circuit breaker
        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
            print(f"\n⚠ Circuit breaker: {MAX_CONSECUTIVE_FAILURES} consecutive failures. Stopping.")
            print("  Fix the issue and run with --resume to continue.")
            break

        # Paced interval between cities (skip after last city)
        if i < len(batch) - 1:
            elapsed = time.time() - city_start
            sleep_time = max(0, interval - elapsed)

            if sleep_time > 0:
                eta = datetime.now(timezone.utc) + timedelta(seconds=sleep_time + cities_remaining * interval)
                print(f"  ⏳ Next city in {format_duration(int(sleep_time))}. {cities_remaining} remaining. ETA: {eta.strftime('%Y-%m-%d %H:%M UTC')}")
                time.sleep(sleep_time)

    print_summary(manifest)


if __name__ == "__main__":
    main()
