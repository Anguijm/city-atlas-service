#!/usr/bin/env npx tsx
/**
 * Enrichment Ingester — writes ONLY new enrichment documents to Firestore.
 *
 * Reads a merged JSON file and filters for documents with source: "enrichment-*".
 * Existing Firestore documents are NEVER touched.
 *
 * Usage:
 *   npx tsx src/pipeline/enrich_ingest.ts --input data/research-output/tokyo.json --city tokyo
 *   npx tsx src/pipeline/enrich_ingest.ts --input data/research-output/tokyo.json --city tokyo --dry-run
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { stripUndefined } from "./strip-undefined.js";

// Initialize Firebase Admin with application default credentials
const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || "urban-explorer-483600",
    });
const db = getFirestore(app, "urbanexplorer");

// Minimal required-field schemas used to guard each document before write.
// These cover only the fields that, if absent, would produce a corrupt
// Firestore document — consumer apps would render broken UI or crash on
// a waypoint with no lat/lng or a neighborhood with no name.
const LocalizedTextSchema = z.object({ en: z.string() }).passthrough();

// id is stored as the Firestore document path, not in the payload —
// do not include it here.
const NeighborhoodWriteSchema = z.object({
  city_id: z.string(),
  name: LocalizedTextSchema,
  lat: z.number(),
  lng: z.number(),
});

const WaypointWriteSchema = z.object({
  city_id: z.string(),
  neighborhood_id: z.string(),
  name: LocalizedTextSchema,
  lat: z.number(),
  lng: z.number(),
  type: z.string(),
});

const TaskWriteSchema = z.object({
  title: LocalizedTextSchema,
  prompt: LocalizedTextSchema,
  points: z.number(),
});

interface LocalizedText {
  en: string;
  [key: string]: string;
}

interface Neighborhood {
  id: string;
  city_id: string;
  name: LocalizedText;
  summary?: LocalizedText;
  lat: number;
  lng: number;
  trending_score: number;
  source?: string;
  enriched_at?: string;
  [key: string]: unknown;
}

interface Waypoint {
  id: string;
  city_id: string;
  neighborhood_id: string;
  name: LocalizedText;
  description?: LocalizedText;
  type: string;
  lat: number;
  lng: number;
  trending_score: number;
  source?: string;
  enriched_at?: string;
  [key: string]: unknown;
}

interface Task {
  id: string;
  neighborhood_id?: string;
  waypoint_id?: string;
  title: LocalizedText;
  prompt: LocalizedText;
  points: number;
  duration_minutes?: number;
  source?: string;
  enriched_at?: string;
  [key: string]: unknown;
}

interface MergedData {
  neighborhoods: Neighborhood[];
  waypoints: Waypoint[];
  tasks: Task[];
  quality_status?: string;
}

function isEnrichment(doc: { source?: string }): boolean {
  return typeof doc.source === "string" && doc.source.startsWith("enrichment-");
}

async function main() {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf("--input");
  const cityIdx = args.indexOf("--city");
  const dryRun = args.includes("--dry-run");

  if (inputIdx === -1 || cityIdx === -1) {
    console.error("Usage: npx tsx src/pipeline/enrich_ingest.ts --input <path> --city <id> [--dry-run]");
    process.exit(1);
  }

  const inputPath = args[inputIdx + 1];
  const cityId = args[cityIdx + 1];

  console.log(`\nEnrichment Ingester${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`Input: ${inputPath}`);
  console.log(`City:  ${cityId}\n`);

  // Read merged JSON
  const data: MergedData = JSON.parse(readFileSync(inputPath, "utf-8"));

  // Filter to enrichment-only documents
  const newNeighborhoods = data.neighborhoods.filter(isEnrichment);
  const newWaypoints = data.waypoints.filter(isEnrichment);
  const newTasks = data.tasks.filter(isEnrichment);

  console.log(`Enrichment documents found:`);
  console.log(`  Neighborhoods: ${newNeighborhoods.length}`);
  console.log(`  Waypoints:     ${newWaypoints.length}`);
  console.log(`  Tasks:         ${newTasks.length}`);

  if (newNeighborhoods.length === 0 && newWaypoints.length === 0 && newTasks.length === 0) {
    console.log("\nNo enrichment documents to write. Done.");
    return;
  }

  if (dryRun) {
    console.log("\nDRY RUN — no writes made.");
    if (newNeighborhoods.length > 0) {
      console.log("\nNew neighborhoods:");
      newNeighborhoods.forEach((n) => console.log(`  ${n.id}: ${n.name.en}`));
    }
    if (newWaypoints.length > 0) {
      console.log("\nNew waypoints:");
      newWaypoints.forEach((w) => console.log(`  ${w.id}: ${w.name.en} (${w.type})`));
    }
    if (newTasks.length > 0) {
      console.log("\nNew tasks (first 10):");
      newTasks.slice(0, 10).forEach((t) => console.log(`  ${t.id}: ${t.title.en}`));
      if (newTasks.length > 10) console.log(`  ... and ${newTasks.length - 10} more`);
    }
    return;
  }

  // Build write operations (dual-write: flat + hierarchical).
  // schema is the Zod guard applied after stripUndefined — only set for
  // document types where missing required fields (lat/lng, name, etc.)
  // would silently corrupt consumer data. City metadata and task ops
  // without structural geometry don't need it.
  type WriteOp = {
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
    merge?: boolean;
    schema?: z.ZodTypeAny;
  };
  const ops: WriteOp[] = [];

  // City-level metadata merge: persist coverageTier + maxRadiusKm from the
  // static city cache into the top-level cities/{cityId} doc. This is a
  // merge write — it does not clobber existing fields like cache_metadata.
  try {
    // Resolve relative to CWD. Script is always run from project root via
    // research-city.py subprocess, so this is stable.
    const cachePath = resolve(process.cwd(), "configs/global_city_cache.json");
    const cityCache = JSON.parse(readFileSync(cachePath, "utf-8")) as Array<{
      id: string;
      coverageTier?: string;
      maxRadiusKm?: number;
    }>;
    const cityEntry = cityCache.find((c) => c.id === cityId);
    if (cityEntry && (cityEntry.coverageTier || cityEntry.maxRadiusKm)) {
      const metadata: Record<string, unknown> = {};
      if (cityEntry.coverageTier) metadata.coverageTier = cityEntry.coverageTier;
      if (cityEntry.maxRadiusKm) metadata.maxRadiusKm = cityEntry.maxRadiusKm;
      ops.push({
        ref: db.collection("cities").doc(cityId),
        data: metadata,
        merge: true,
      });
      console.log(`  → City metadata: coverageTier=${cityEntry.coverageTier || "(unset)"}, maxRadiusKm=${cityEntry.maxRadiusKm || "(unset)"}`);
    }
  } catch (err) {
    console.warn(`  ⚠ Could not read city cache for tier metadata: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Neighborhoods
  for (const n of newNeighborhoods) {
    const payload: Record<string, unknown> = {
      name: n.name,
      city_id: n.city_id,
      trending_score: n.trending_score,
      summary: n.summary,
      lat: n.lat,
      lng: n.lng,
      is_active: true,
      source: n.source,
      enriched_at: n.enriched_at,
    };
    ops.push({ ref: db.collection("vibe_neighborhoods").doc(n.id), data: payload, schema: NeighborhoodWriteSchema });
    ops.push({
      ref: db.collection("cities").doc(cityId).collection("neighborhoods").doc(n.id),
      data: payload,
      schema: NeighborhoodWriteSchema,
    });
  }

  // Waypoints
  for (const w of newWaypoints) {
    const payload: Record<string, unknown> = {
      name: w.name,
      city_id: w.city_id,
      neighborhood_id: w.neighborhood_id,
      type: w.type,
      lat: w.lat,
      lng: w.lng,
      trending_score: w.trending_score,
      description: w.description,
      is_active: true,
      source: w.source,
      enriched_at: w.enriched_at,
    };
    ops.push({ ref: db.collection("vibe_waypoints").doc(w.id), data: payload, schema: WaypointWriteSchema });
    ops.push({
      ref: db
        .collection("cities")
        .doc(cityId)
        .collection("neighborhoods")
        .doc(w.neighborhood_id)
        .collection("waypoints")
        .doc(w.id),
      data: payload,
      schema: WaypointWriteSchema,
    });
  }

  // Tasks
  for (const t of newTasks) {
    const nhId = t.neighborhood_id || "";
    const payload: Record<string, unknown> = {
      neighborhood_id: t.neighborhood_id,
      title: t.title,
      prompt: t.prompt,
      points: t.points ?? 10,
      duration_minutes: t.duration_minutes ?? 5,
      source: t.source,
      enriched_at: t.enriched_at,
    };
    // Include waypoint_id if present (legacy compat)
    if (t.waypoint_id) payload.waypoint_id = t.waypoint_id;

    ops.push({ ref: db.collection("vibe_tasks").doc(t.id), data: payload, schema: TaskWriteSchema });
    if (nhId) {
      ops.push({
        ref: db
          .collection("cities")
          .doc(cityId)
          .collection("neighborhoods")
          .doc(nhId)
          .collection("tasks")
          .doc(t.id),
        data: payload,
        schema: TaskWriteSchema,
      });
    }
  }

  // Commit in batches of 500
  const BATCH_SIZE = 500;
  let written = 0;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const chunk = ops.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const op of chunk) {
      const data = stripUndefined(op.data as Record<string, unknown>);
      // Guard required fields after strip: a Gemini regression that emits
      // undefined for lat/lng/name would produce a corrupt document without
      // this check. Throws loudly rather than writing invalid data.
      if (op.schema) {
        const result = op.schema.safeParse(data);
        if (!result.success) {
          throw new Error(
            `Required field validation failed for ${op.ref.path}: ${result.error.message}`
          );
        }
      }
      if (op.merge) {
        batch.set(op.ref, data, { merge: true });
      } else {
        batch.set(op.ref, data);
      }
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  Committed batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} ops)`);
  }

  console.log(`\n✓ Done: ${written} total operations`);
  console.log(`  ${newNeighborhoods.length} neighborhoods, ${newWaypoints.length} waypoints, ${newTasks.length} tasks written to Firestore`);
}

main().catch((err) => {
  console.error("Enrichment ingestion failed:", err);
  process.exit(1);
});
