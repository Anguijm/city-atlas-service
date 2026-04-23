import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { City, Neighborhood, Task } from '@/schemas/cityAtlas';
import type { ValidatedWaypoint } from '../pipeline/build_cache';

// ---------------------------------------------------------------------------
// Firebase Admin mocks
// ---------------------------------------------------------------------------

const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockBatch = { set: mockBatchSet, commit: mockBatchCommit };

const mockDocGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });

const mockGetFirestore = vi.fn(() => ({
  collection: vi.fn((name: string) => ({
    doc: vi.fn((id: string) => ({
      id,
      path: `${name}/${id}`,
      get: mockDocGet,
      collection: vi.fn((sub: string) => ({
        doc: vi.fn((subId: string) => ({
          id: subId,
          path: `${name}/${id}/${sub}/${subId}`,
          collection: vi.fn((sub2: string) => ({
            doc: vi.fn((sub2Id: string) => ({
              id: sub2Id,
              path: `${name}/${id}/${sub}/${subId}/${sub2}/${sub2Id}`,
            })),
          })),
        })),
      })),
    })),
  })),
  batch: vi.fn(() => mockBatch),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: (...args: unknown[]) => mockGetFirestore(...args),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  },
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'mock-app' })),
  getApps: vi.fn(() => [{ name: 'mock-app' }]),
  cert: vi.fn(),
}));

vi.mock('fs/promises', () => {
  const readFile = vi.fn(async () => JSON.stringify([]));
  return { default: { readFile }, readFile };
});

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn(),
    })),
  })),
}));

const { writeCityToFirestore, VibeCacheError } =
  await import('../pipeline/build_cache');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const city: City = {
  id: 'tokyo',
  name: 'Tokyo',
  country: 'Japan',
  region: 'asia-pacific',
  lat: 35.6762,
  lng: 139.6503,
  tier: 'tier1',
};

function makeNeighborhoods(count: number): Neighborhood[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tokyo-n${i}`,
    city_id: 'tokyo',
    name: { en: `Neighborhood ${i}` },
    lat: 35.6 + i * 0.05,
    lng: 139.6 + i * 0.05,
    trending_score: 70 + i,
  }));
}

function makeWaypoints(neighborhoods: Neighborhood[], perNeighborhood: number): ValidatedWaypoint[] {
  const waypoints: ValidatedWaypoint[] = [];
  for (const n of neighborhoods) {
    for (let w = 0; w < perNeighborhood; w++) {
      waypoints.push({
        id: `${n.id}-w${w}`,
        city_id: 'tokyo',
        neighborhood_id: n.id,
        name: { en: `Waypoint ${w}` },
        type: 'food',
        lat: 35.6 + w * 0.01,
        lng: 139.6 + w * 0.01,
        trending_score: 60,
        google_place_id: `ChIJ_${n.id}_${w}`,
        business_status: 'OPERATIONAL',
        validation_status: 'VALIDATED',
        last_validated: '2026-03-15T00:00:00.000Z',
      });
    }
  }
  return waypoints;
}

function makeTasks(waypoints: ValidatedWaypoint[], perNeighborhood: number): Task[] {
  const tasks: Task[] = [];
  // Group waypoints by neighborhood, then assign tasks
  const byNeighborhood = new Map<string, ValidatedWaypoint[]>();
  for (const w of waypoints) {
    const list = byNeighborhood.get(w.neighborhood_id) ?? [];
    list.push(w);
    byNeighborhood.set(w.neighborhood_id, list);
  }

  for (const [, nWaypoints] of byNeighborhood) {
    for (let t = 0; t < perNeighborhood; t++) {
      const wp = nWaypoints[t % nWaypoints.length];
      tasks.push({
        id: `${wp.id}-task-${t}`,
        waypoint_id: wp.id,
        title: { en: `Task ${t}` },
        prompt: { en: `Do task ${t}` },
        points: 10,
        duration_minutes: 5,
      });
    }
  }
  return tasks;
}

describe('Epic 4 — Firestore Batch Writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
    mockBatchCommit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: creates city document at cities/{city.id}
  it('creates a document at cities/tokyo with cache_metadata.source_version = baseline_v1', async () => {
    const neighborhoods = makeNeighborhoods(6);
    const waypoints = makeWaypoints(neighborhoods, 8);
    const tasks = makeTasks(waypoints, 12);

    await writeCityToFirestore(city, neighborhoods, waypoints, tasks);

    // Find the batch set call for the city doc
    const cityCalls = mockBatchSet.mock.calls.filter(
      (call: unknown[]) => (call[0] as { path: string }).path === 'cities/tokyo',
    );
    expect(cityCalls.length).toBeGreaterThanOrEqual(1);

    const cityPayload = cityCalls[0][1] as Record<string, unknown>;
    expect((cityPayload.cache_metadata as Record<string, unknown>).source_version).toBe('baseline_v1');
  });

  // Test 2: creates 6 neighborhood documents in subcollection
  it('creates 6 neighborhood subcollection documents', async () => {
    const neighborhoods = makeNeighborhoods(6);
    const waypoints = makeWaypoints(neighborhoods, 8);
    const tasks = makeTasks(waypoints, 12);

    await writeCityToFirestore(city, neighborhoods, waypoints, tasks);

    const neighborhoodSubCalls = mockBatchSet.mock.calls.filter(
      (call: unknown[]) => {
        const path = (call[0] as { path: string }).path;
        // Match only direct neighborhood subcollection paths (not nested waypoints/tasks)
        return path.match(/^cities\/tokyo\/neighborhoods\/[^/]+$/) !== null;
      },
    );
    expect(neighborhoodSubCalls.length).toBe(6);

    // Check payload has required fields
    for (const call of neighborhoodSubCalls) {
      const payload = call[1] as Record<string, unknown>;
      expect(payload).toHaveProperty('name');
      expect(payload).toHaveProperty('trending_score');
      expect(payload.is_active).toBe(true);
    }
  });

  // Test 3: creates 48 waypoint documents
  it('creates 48 waypoint subcollection documents', async () => {
    const neighborhoods = makeNeighborhoods(6);
    const waypoints = makeWaypoints(neighborhoods, 8);
    const tasks = makeTasks(waypoints, 12);

    await writeCityToFirestore(city, neighborhoods, waypoints, tasks);

    const waypointSubCalls = mockBatchSet.mock.calls.filter(
      (call: unknown[]) => {
        const path = (call[0] as { path: string }).path;
        return path.startsWith('cities/') && path.includes('/waypoints/');
      },
    );
    expect(waypointSubCalls.length).toBe(48); // subcollection only, flat is separate

    for (const call of waypointSubCalls) {
      const payload = call[1] as Record<string, unknown>;
      expect(payload).toHaveProperty('google_place_id');
      expect(payload).toHaveProperty('business_status');
      expect(payload.is_active).toBe(true);
      expect(payload).toHaveProperty('last_validated');
    }
  });

  // Test 4: creates 72 task documents
  it('creates 72 task subcollection documents', async () => {
    const neighborhoods = makeNeighborhoods(6);
    const waypoints = makeWaypoints(neighborhoods, 8);
    const tasks = makeTasks(waypoints, 12);

    await writeCityToFirestore(city, neighborhoods, waypoints, tasks);

    const taskSubCalls = mockBatchSet.mock.calls.filter(
      (call: unknown[]) => {
        const path = (call[0] as { path: string }).path;
        return path.startsWith('cities/') && path.includes('/tasks/');
      },
    );
    expect(taskSubCalls.length).toBe(72);

    for (const call of taskSubCalls) {
      const payload = call[1] as Record<string, unknown>;
      expect(payload).toHaveProperty('prompt');
      expect(payload).toHaveProperty('points');
    }
  });

  // Test 5: batch commit called exactly once for < 500 ops
  it('commits batch exactly once for a full city (< 500 ops)', async () => {
    const neighborhoods = makeNeighborhoods(6);
    const waypoints = makeWaypoints(neighborhoods, 8);
    const tasks = makeTasks(waypoints, 12);

    await writeCityToFirestore(city, neighborhoods, waypoints, tasks);

    // Total ops: 1 city + 6*2 neighborhoods + 48*2 waypoints + 72*2 tasks
    //          = 1 + 12 + 96 + 144 = 253 (< 500)
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  // Test 6: writes flat denormalized documents
  it('writes flat documents to vibe_neighborhoods, vibe_waypoints, vibe_tasks', async () => {
    const neighborhoods = makeNeighborhoods(6);
    const waypoints = makeWaypoints(neighborhoods, 8);
    const tasks = makeTasks(waypoints, 12);

    await writeCityToFirestore(city, neighborhoods, waypoints, tasks);

    const flatNeighborhoodCalls = mockBatchSet.mock.calls.filter(
      (call: unknown[]) =>
        (call[0] as { path: string }).path.startsWith('vibe_neighborhoods/'),
    );
    const flatWaypointCalls = mockBatchSet.mock.calls.filter(
      (call: unknown[]) =>
        (call[0] as { path: string }).path.startsWith('vibe_waypoints/'),
    );
    const flatTaskCalls = mockBatchSet.mock.calls.filter(
      (call: unknown[]) =>
        (call[0] as { path: string }).path.startsWith('vibe_tasks/'),
    );

    expect(flatNeighborhoodCalls.length).toBe(6);
    expect(flatWaypointCalls.length).toBe(48);
    expect(flatTaskCalls.length).toBe(72);
  });

  // Test 7: throws FIRESTORE_WRITE_FAILED on commit failure
  it('throws VibeCacheError(FIRESTORE_WRITE_FAILED) on batch commit failure', async () => {
    mockBatchCommit.mockRejectedValue(new Error('Firestore unavailable'));

    const neighborhoods = makeNeighborhoods(1);
    const waypoints = makeWaypoints(neighborhoods, 1);
    const tasks = makeTasks(waypoints, 1);

    await expect(
      writeCityToFirestore(city, neighborhoods, waypoints, tasks),
    ).rejects.toThrow(VibeCacheError);
    await expect(
      writeCityToFirestore(city, neighborhoods, waypoints, tasks),
    ).rejects.toMatchObject({ code: 'FIRESTORE_WRITE_FAILED' });
  });
});
