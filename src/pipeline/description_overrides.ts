/**
 * Approved plain-word place lines (U51, 2026-11-10).
 *
 * The pipeline writes a place's line from its sources (Gemini research, the
 * OSM listing, Wikipedia's first sentence). A line rewritten by hand and
 * approved by John lives in data/description-overrides.json, keyed by
 * waypoint id, and wins over all of them at the one place every ingest goes
 * through: writeCityToFirestore in build_cache.ts. Without this, the next
 * pipeline run for a town would quietly put the old wording back.
 *
 * An override sets `description` to `{ en: line }`: any other locale held
 * for the old line would be a translation of words no longer shown, so it
 * is dropped, and localization fills it again from the new line.
 *
 * Read with readFileSync from node:fs rather than fs/promises, which the
 * Firestore writer's tests mock.
 */
import { readFileSync } from 'node:fs';

export interface DescriptionOverride {
  /** The line shown. Every fact in it is from `source`; nothing is added. */
  line: string;
  /** Where its facts come from, e.g. "wikipedia:Stuhr Museum". */
  source: string;
  /** Who approved it and when, e.g. "John, 2026-11-10". */
  approved: string;
}

export type DescriptionOverrides = Record<string, DescriptionOverride>;

/**
 * The longest line an override may hold: Roadtripper wraps a line whole and
 * never cuts it, and wiki_describe.py's MAX_CHARS (240) is about five lines
 * on a 390 px phone. Keep the two equal.
 */
export const MAX_OVERRIDE_CHARS = 240;

const DEFAULT_PATH = new URL('../../data/description-overrides.json', import.meta.url);

/** The overrides, checked; keys starting "_" are notes. Throws on a malformed entry, so a bad edit fails the ingest loudly. */
export function loadDescriptionOverrides(path: URL | string = DEFAULT_PATH): DescriptionOverrides {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const out: DescriptionOverrides = {};
  for (const [id, v] of Object.entries(raw)) {
    if (id.startsWith('_')) continue;
    const o = v as Partial<DescriptionOverride> | null;
    if (!o || typeof o.line !== 'string' || o.line.trim() === '' || typeof o.source !== 'string' || typeof o.approved !== 'string') {
      throw new Error(`description override ${id}: needs line, source and approved`);
    }
    if (o.line.length > MAX_OVERRIDE_CHARS) {
      throw new Error(`description override ${id}: line is ${o.line.length} characters, over ${MAX_OVERRIDE_CHARS}`);
    }
    out[id] = { line: o.line.trim(), source: o.source, approved: o.approved };
  }
  return out;
}

/** The waypoints with each overridden line in place; the rest untouched. Pure. */
export function applyDescriptionOverrides<T extends { id: string; description?: unknown }>(
  waypoints: readonly T[],
  overrides: DescriptionOverrides,
): T[] {
  return waypoints.map((w) => (overrides[w.id] ? { ...w, description: { en: overrides[w.id].line } } : w));
}
