import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read the actual firestore.indexes.json file
const indexPath = resolve(__dirname, '../../firestore.indexes.json');

describe('Epic 6 — Firestore Index Definitions', () => {
  let indexes: {
    indexes: Array<{
      collectionGroup: string;
      queryScope: string;
      fields: Array<{ fieldPath: string; order?: string }>;
    }>;
    fieldOverrides?: unknown[];
  };

  // Test 1: firestore.indexes.json exists and is valid JSON
  it('firestore.indexes.json exists and is valid JSON', () => {
    const content = readFileSync(indexPath, 'utf-8');
    indexes = JSON.parse(content);
    expect(indexes).toBeDefined();
    expect(indexes.indexes).toBeInstanceOf(Array);
  });

  // Test 2: composite index for vibe_neighborhoods
  it('contains composite index for vibe_neighborhoods [city_id ASC, trending_score DESC]', () => {
    const content = readFileSync(indexPath, 'utf-8');
    indexes = JSON.parse(content);

    const idx = indexes.indexes.find(
      (i) => i.collectionGroup === 'vibe_neighborhoods',
    );
    expect(idx).toBeDefined();
    expect(idx!.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldPath: 'city_id', order: 'ASCENDING' }),
        expect.objectContaining({
          fieldPath: 'trending_score',
          order: 'DESCENDING',
        }),
      ]),
    );
  });

  // Test 3: composite index for vibe_waypoints
  it('contains composite index for vibe_waypoints [city_id ASC, neighborhood_id ASC, trending_score DESC]', () => {
    const content = readFileSync(indexPath, 'utf-8');
    indexes = JSON.parse(content);

    const idx = indexes.indexes.find(
      (i) => i.collectionGroup === 'vibe_waypoints',
    );
    expect(idx).toBeDefined();
    expect(idx!.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldPath: 'city_id', order: 'ASCENDING' }),
        expect.objectContaining({
          fieldPath: 'neighborhood_id',
          order: 'ASCENDING',
        }),
        expect.objectContaining({
          fieldPath: 'trending_score',
          order: 'DESCENDING',
        }),
      ]),
    );
  });

  // Test 4: composite index for seasonal_variants
  it('contains composite index for seasonal_variants [city_id ASC, starts_at ASC, ends_at ASC]', () => {
    const content = readFileSync(indexPath, 'utf-8');
    indexes = JSON.parse(content);

    const idx = indexes.indexes.find(
      (i) => i.collectionGroup === 'seasonal_variants',
    );
    expect(idx).toBeDefined();
    expect(idx!.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldPath: 'city_id', order: 'ASCENDING' }),
        expect.objectContaining({
          fieldPath: 'starts_at',
          order: 'ASCENDING',
        }),
        expect.objectContaining({ fieldPath: 'ends_at', order: 'ASCENDING' }),
      ]),
    );
  });

  // Test 5: vibe_tasks single-field index is auto-created by Firestore (removed from indexes.json)
  it('does not contain vibe_tasks (single-field indexes are auto-created by Firestore)', () => {
    const content = readFileSync(indexPath, 'utf-8');
    indexes = JSON.parse(content);

    const idx = indexes.indexes.find(
      (i) => i.collectionGroup === 'vibe_tasks',
    );
    expect(idx).toBeUndefined();
  });

  // Test 6: composite index for saved_hunts (userId + isArchived + createdAt)
  it('contains composite index for saved_hunts [userId ASC, isArchived ASC, createdAt DESC]', () => {
    const content = readFileSync(indexPath, 'utf-8');
    indexes = JSON.parse(content);

    const idx = indexes.indexes.find(
      (i) =>
        i.collectionGroup === 'saved_hunts' &&
        i.fields.some((f: { fieldPath: string }) => f.fieldPath === 'isArchived'),
    );
    expect(idx).toBeDefined();
    expect(idx!.fields).toEqual([
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'isArchived', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ]);
  });

  // Test 7: composite index for saved_hunts idempotency (userId + title + createdAt)
  it('contains composite index for saved_hunts [userId ASC, title ASC, createdAt DESC]', () => {
    const content = readFileSync(indexPath, 'utf-8');
    indexes = JSON.parse(content);

    const idx = indexes.indexes.find(
      (i) =>
        i.collectionGroup === 'saved_hunts' &&
        i.fields.some((f: { fieldPath: string }) => f.fieldPath === 'title'),
    );
    expect(idx).toBeDefined();
    expect(idx!.fields).toEqual([
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'title', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ]);
  });
});
