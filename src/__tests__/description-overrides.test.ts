import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyDescriptionOverrides,
  loadDescriptionOverrides,
  MAX_OVERRIDE_CHARS,
} from '../pipeline/description_overrides';

/** Approved plain-word place lines (U51): the file, the rule, the guard. */

const tmpFile = (body: unknown) => {
  const p = join(mkdtempSync(join(tmpdir(), 'overrides-')), 'o.json');
  writeFileSync(p, JSON.stringify(body));
  return p;
};

describe('the approved overrides file', () => {
  it('loads, and every line is sourced, approved and short enough to show whole', () => {
    const o = loadDescriptionOverrides();
    expect(Object.keys(o).length).toBe(6);
    for (const [id, v] of Object.entries(o)) {
      expect(id).not.toMatch(/^_/);
      // A source the pipeline scrapes and keeps in data/: Wikipedia for the
      // U51 five, Atlas Obscura's listing for Toledo's Cloister (2026-11-10).
      expect(v.source).toMatch(/^(wikipedia|atlas-obscura):\S/);
      expect(v.approved).toMatch(/John, \d{4}-\d{2}-\d{2}/);
      expect(v.line.length).toBeLessThanOrEqual(MAX_OVERRIDE_CHARS);
    }
    expect(o['toledo-oh-the-old-west-end-the-cloister-at-the-toledo-museum-of-art'].line).toBe(
      'A courtyard framed by centuries-old columns from French monasteries.',
    );
    expect(o['grand-island-ne-fonner-park-the-east-side-hub-fonner-park'].line).toBe(
      'Thoroughbred racetrack since 1954; the Hall County and Nebraska State Fairs are held here too.',
    );
  });
});

describe('applying overrides', () => {
  const overrides = { a: { line: 'New line.', source: 'wikipedia:A', approved: 'John, 2026-11-10' } };

  it('replaces the line of an overridden place, drops its stale translations, and leaves the rest alone', () => {
    const out = applyDescriptionOverrides(
      [
        { id: 'a', description: { en: 'Old line.', ja: '古い' } },
        { id: 'b', description: { en: 'Kept.' } },
      ],
      overrides,
    );
    expect(out[0].description).toEqual({ en: 'New line.' });
    expect(out[1].description).toEqual({ en: 'Kept.' });
  });

  it('fails loudly on a malformed or over-long entry, so a bad edit stops the ingest', () => {
    expect(() => loadDescriptionOverrides(tmpFile({ a: { line: '', source: 's', approved: 'x' } }))).toThrow(/needs line/);
    expect(() => loadDescriptionOverrides(tmpFile({ a: { line: 'x'.repeat(MAX_OVERRIDE_CHARS + 1), source: 's', approved: 'x' } }))).toThrow(/over 240/);
    expect(loadDescriptionOverrides(tmpFile({ _note: 'skipped', a: { line: ' ok ', source: 's', approved: 'x' } }))).toEqual({
      a: { line: 'ok', source: 's', approved: 'x' },
    });
  });
});
