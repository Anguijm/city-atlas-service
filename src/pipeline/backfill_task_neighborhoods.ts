#!/usr/bin/env npx tsx
/**
 * Backfill neighborhood_id on vibe_tasks documents.
 *
 * For each task that has a waypoint_id but no neighborhood_id, looks up the
 * waypoint in vibe_waypoints and copies its neighborhood_id onto the task.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/application_default_credentials.json \
 *   GOOGLE_CLOUD_PROJECT=urban-explorer-483600 \
 *   npx tsx src/pipeline/backfill_task_neighborhoods.ts
 *
 * Optional flags:
 *   --dry-run   Print what would be updated without writing to Firestore
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// Firebase init (same pattern as build-vibe-cache.ts)
// ---------------------------------------------------------------------------

const app = getApps().length > 0
  ? getApps()[0]
  : process.env.FIREBASE_SERVICE_ACCOUNT_KEY
    ? initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) })
    : initializeApp();

const db = getFirestore(app, 'urbanexplorer');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const dryRun = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[backfill] Starting task neighborhood backfill${dryRun ? ' (DRY RUN)' : ''}...`);

  // 1. Build waypoint_id -> neighborhood_id lookup map
  console.log('[backfill] Loading waypoints...');
  const waypointSnap = await db.collection('vibe_waypoints').get();
  const waypointNeighborhood = new Map<string, string>();

  for (const doc of waypointSnap.docs) {
    const data = doc.data();
    if (data.neighborhood_id) {
      waypointNeighborhood.set(doc.id, data.neighborhood_id as string);
    }
  }
  console.log(`[backfill] Loaded ${waypointNeighborhood.size} waypoints with neighborhood_id.`);

  // 2. Iterate all tasks
  console.log('[backfill] Loading tasks...');
  const taskSnap = await db.collection('vibe_tasks').get();
  console.log(`[backfill] Found ${taskSnap.size} total tasks.`);

  let updated = 0;
  let alreadyHad = 0;
  let orphaned = 0;
  let noWaypointId = 0;

  // Collect updates, then batch write
  const updates: Array<{ docId: string; neighborhoodId: string }> = [];

  for (const doc of taskSnap.docs) {
    const data = doc.data();

    // Already has neighborhood_id
    if (data.neighborhood_id) {
      alreadyHad++;
      continue;
    }

    // No waypoint_id to look up
    if (!data.waypoint_id) {
      noWaypointId++;
      continue;
    }

    const nhId = waypointNeighborhood.get(data.waypoint_id as string);
    if (!nhId) {
      orphaned++;
      console.warn(`[backfill] Orphaned task ${doc.id}: waypoint_id="${data.waypoint_id}" not found in vibe_waypoints.`);
      continue;
    }

    updates.push({ docId: doc.id, neighborhoodId: nhId });
  }

  // 3. Batch write (max 500 per batch)
  if (!dryRun && updates.length > 0) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const chunk = updates.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const { docId, neighborhoodId } of chunk) {
        const ref = db.collection('vibe_tasks').doc(docId);
        batch.update(ref, { neighborhood_id: neighborhoodId });
      }

      await batch.commit();
      console.log(`[backfill] Committed batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} docs).`);
    }
    updated = updates.length;
  } else if (dryRun) {
    updated = updates.length;
    for (const { docId, neighborhoodId } of updates.slice(0, 10)) {
      console.log(`[backfill] Would update ${docId} -> neighborhood_id="${neighborhoodId}"`);
    }
    if (updates.length > 10) {
      console.log(`[backfill] ... and ${updates.length - 10} more.`);
    }
  }

  // 4. Summary
  console.log('\n[backfill] === Summary ===');
  console.log(`  Updated:              ${updated}`);
  console.log(`  Already had nh_id:    ${alreadyHad}`);
  console.log(`  Orphaned (no wp):     ${orphaned}`);
  console.log(`  No waypoint_id:       ${noWaypointId}`);
  console.log(`  Total tasks:          ${taskSnap.size}`);
  if (dryRun) console.log('  (DRY RUN — no writes made)');
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});
