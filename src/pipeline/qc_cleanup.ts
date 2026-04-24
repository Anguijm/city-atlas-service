#!/usr/bin/env npx tsx
/**
 * Post-Enrichment QC Cleanup
 *
 * Detects and reports data quality issues across Firestore:
 * - Duplicate neighborhoods (fuzzy name match + proximity clustering)
 * - Orphaned tasks/waypoints (pointing to deleted neighborhoods)
 * - Stale data (CLOSED_PERMANENTLY waypoints)
 * - Inconsistent ID formats (missing city_id prefix)
 *
 * Usage:
 *   npx tsx src/pipeline/qc_cleanup.ts                # Report all cities (dry-run)
 *   npx tsx src/pipeline/qc_cleanup.ts --city dallas  # Single city
 *   npx tsx src/pipeline/qc_cleanup.ts --execute      # Apply fixes (DANGEROUS)
 */

import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || "urban-explorer-483600",
    });
const db = getFirestore(app, "urbanexplorer");

interface QCIssue {
  type: "duplicate_neighborhood" | "orphan_task" | "orphan_waypoint" | "stale_business" | "bad_id_format";
  cityId: string;
  severity: "high" | "medium" | "low";
  details: string;
  action: string;
  data?: { canonicalId: string; duplicateIds: string[] };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function nameOf(doc: Record<string, unknown>): string {
  const name = doc.name as { en?: string } | string | undefined;
  if (typeof name === "string") return name;
  return name?.en || "";
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fuzzyMatch(a: string, b: string): number {
  // Simple slug overlap score 0-1
  const sa = slugify(a);
  const sb = slugify(b);
  if (sa === sb) return 1;
  if (sa.includes(sb) || sb.includes(sa)) return 0.9;
  // Token overlap
  const ta = new Set(sa.split("-"));
  const tb = new Set(sb.split("-"));
  const intersection = [...ta].filter((x) => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 ? intersection / union : 0;
}

async function qcCity(cityId: string): Promise<QCIssue[]> {
  const issues: QCIssue[] = [];

  // 1. Load all data for the city
  const nhSnap = await db.collection("vibe_neighborhoods").where("city_id", "==", cityId).get();
  const wpSnap = await db.collection("vibe_waypoints").where("city_id", "==", cityId).get();

  const neighborhoods = nhSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }));
  const waypoints = wpSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }));

  // 2. ID format check (missing city_id prefix)
  const idRegex = new RegExp(`^${cityId}-[a-z0-9-]+$`);
  for (const n of neighborhoods) {
    if (!idRegex.test(n.id)) {
      issues.push({
        type: "bad_id_format",
        cityId,
        severity: "medium",
        details: `Neighborhood ${n.id} does not match ${cityId}-{slug} format`,
        action: `rename or archive ${n.id}`,
      });
    }
  }

  // 3. Duplicate neighborhoods (fuzzy name + proximity)
  const clusters: Array<typeof neighborhoods> = [];
  for (const n of neighborhoods) {
    const name = nameOf(n);
    const lat = n.lat as number;
    const lng = n.lng as number;
    if (!name || lat == null || lng == null) continue;

    let foundCluster = false;
    for (const cluster of clusters) {
      const first = cluster[0];
      const fName = nameOf(first);
      const fLat = first.lat as number;
      const fLng = first.lng as number;
      const similarity = fuzzyMatch(name, fName);
      const distance = haversineKm(lat, lng, fLat, fLng);
      // Group if very similar name AND close in coordinates
      if (similarity >= 0.7 && distance < 2) {
        cluster.push(n);
        foundCluster = true;
        break;
      }
    }
    if (!foundCluster) clusters.push([n]);
  }

  for (const cluster of clusters) {
    if (cluster.length > 1) {
      // Pick canonical: prefer `{city}-{real-slug}` format, deprioritize `{city}-nh-N` artifacts
      const artifactRegex = new RegExp(`^${cityId}-nh-\\d+$`);
      const goodFormat = cluster.filter((n) => idRegex.test(n.id) && !artifactRegex.test(n.id));
      const canonical =
        goodFormat.reduce<(typeof cluster)[number] | null>(
          (a, b) => (a === null || b.id.length < a.id.length ? b : a),
          null
        ) ||
        cluster.find((n) => idRegex.test(n.id)) ||
        cluster.reduce((a, b) => (a.id.length <= b.id.length ? a : b));
      const dupes = cluster.filter((n) => n.id !== canonical.id).map((n) => n.id);
      issues.push({
        type: "duplicate_neighborhood",
        cityId,
        severity: "high",
        details: `${cluster.length} neighborhoods cluster as "${nameOf(canonical)}": canonical=${canonical.id}, duplicates=${dupes.join(",")}`,
        action: `remap waypoints/tasks from duplicates to ${canonical.id}, archive duplicates`,
        data: { canonicalId: canonical.id, duplicateIds: dupes },
      });
    }
  }

  // 4. Orphaned waypoints (neighborhood_id not in neighborhoods list)
  const nhIds = new Set(neighborhoods.map((n) => n.id));
  for (const w of waypoints) {
    const nhId = w.neighborhood_id as string | undefined;
    if (nhId && !nhIds.has(nhId)) {
      issues.push({
        type: "orphan_waypoint",
        cityId,
        severity: "medium",
        details: `Waypoint ${w.id} references missing neighborhood ${nhId}`,
        action: `remap to canonical neighborhood or archive`,
      });
    }
  }

  // 5. Stale businesses (CLOSED_PERMANENTLY)
  const closed = waypoints.filter((w) => w.business_status === "CLOSED_PERMANENTLY");
  if (closed.length > 0) {
    issues.push({
      type: "stale_business",
      cityId,
      severity: "low",
      details: `${closed.length} waypoints marked CLOSED_PERMANENTLY: ${closed.slice(0, 5).map((w) => w.id).join(", ")}${closed.length > 5 ? "..." : ""}`,
      action: `set is_active: false or re-validate via Places API`,
    });
  }

  return issues;
}

async function main() {
  const args = process.argv.slice(2);
  const cityFilter = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;
  const execute = args.includes("--execute");

  console.log(`\nQC Cleanup Report${execute ? " (EXECUTE MODE)" : " (DRY RUN)"}`);
  console.log("=".repeat(60));

  // Get city list
  let cities: string[];
  if (cityFilter) {
    cities = [cityFilter];
  } else {
    const cacheRaw = await import("../../configs/global_city_cache.json", { with: { type: "json" } });
    const cache = (cacheRaw.default || cacheRaw) as Array<{ id: string }>;
    cities = cache.map((c) => c.id);
  }

  const allIssues: QCIssue[] = [];
  for (const cityId of cities) {
    const issues = await qcCity(cityId);
    allIssues.push(...issues);
    if (issues.length > 0) {
      console.log(`\n[${cityId}] ${issues.length} issues:`);
      for (const i of issues) {
        const icon = i.severity === "high" ? "🔴" : i.severity === "medium" ? "🟡" : "🔵";
        console.log(`  ${icon} ${i.type}: ${i.details}`);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const i of allIssues) {
    byType[i.type] = (byType[i.type] || 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
  }
  console.log(`\nTotal issues: ${allIssues.length}`);
  console.log(`Cities checked: ${cities.length}`);
  console.log(`\nBy type:`);
  for (const [t, c] of Object.entries(byType)) console.log(`  ${t}: ${c}`);
  console.log(`\nBy severity:`);
  for (const [s, c] of Object.entries(bySeverity)) console.log(`  ${s}: ${c}`);

  if (!execute) {
    console.log(`\n⚠ This was a dry run. To apply fixes, run with --execute.`);
    console.log(`   (Not all fixes are automated — manual review recommended for duplicates.)`);
    return;
  }

  // EXECUTE MODE: automated duplicate neighborhood remap + soft-delete
  console.log("\n" + "=".repeat(60));
  console.log("EXECUTE: duplicate neighborhood cleanup");
  console.log("=".repeat(60));

  const dupeIssues = allIssues.filter(
    (i) => i.type === "duplicate_neighborhood" && i.data
  );
  if (dupeIssues.length === 0) {
    console.log("No duplicate neighborhoods to clean up.");
    return;
  }

  let totalWpRemapped = 0;
  let totalTasksRemapped = 0;
  let totalNhArchived = 0;

  for (const issue of dupeIssues) {
    const { canonicalId, duplicateIds } = issue.data!;
    console.log(`\n[${issue.cityId}] → ${canonicalId} (${duplicateIds.length} dupes)`);

    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops > 0) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };

    // Firestore 'in' limit is 30 (admin SDK); chunk to 10 to be safe
    for (let i = 0; i < duplicateIds.length; i += 10) {
      const chunk = duplicateIds.slice(i, i + 10);

      // Remap waypoints
      const wpSnap = await db
        .collection("vibe_waypoints")
        .where("neighborhood_id", "in", chunk)
        .get();
      for (const doc of wpSnap.docs) {
        batch.update(doc.ref, { neighborhood_id: canonicalId });
        ops++;
        totalWpRemapped++;
        if (ops >= 400) await flush();
      }

      // Remap tasks
      const tSnap = await db
        .collection("vibe_tasks")
        .where("neighborhood_id", "in", chunk)
        .get();
      for (const doc of tSnap.docs) {
        batch.update(doc.ref, { neighborhood_id: canonicalId });
        ops++;
        totalTasksRemapped++;
        if (ops >= 400) await flush();
      }
    }

    // Soft-delete duplicate neighborhoods
    for (const dupId of duplicateIds) {
      batch.update(db.collection("vibe_neighborhoods").doc(dupId), {
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_reason: `duplicate of ${canonicalId}`,
      });
      ops++;
      totalNhArchived++;
      if (ops >= 400) await flush();
    }

    await flush();
    console.log(`  ✓ remapped + archived`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`EXECUTE SUMMARY`);
  console.log("=".repeat(60));
  console.log(`  Waypoints remapped: ${totalWpRemapped}`);
  console.log(`  Tasks remapped:     ${totalTasksRemapped}`);
  console.log(`  Neighborhoods archived: ${totalNhArchived}`);
}

main().catch((err) => {
  console.error("QC failed:", err);
  process.exit(1);
});
