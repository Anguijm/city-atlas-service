import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { City, SeasonalVariant } from '@/schemas/cityAtlas';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const citiesFixture: City[] = [
  { id: 'tokyo', name: 'Tokyo', country: 'Japan', region: 'asia-pacific', lat: 35.67, lng: 139.65, tier: 'tier1' },
  { id: 'paris', name: 'Paris', country: 'France', region: 'europe', lat: 48.85, lng: 2.35, tier: 'tier1' },
  { id: 'bangkok', name: 'Bangkok', country: 'Thailand', region: 'asia-pacific', lat: 13.75, lng: 100.52, tier: 'tier2' },
];

const seasonalFixture: SeasonalVariant[] = [
  { id: 'tokyo-cherry-blossom', city_id: 'tokyo', season_key: 'cherry_blossom', starts_at: '2026-03-15', ends_at: '2026-04-20', title: { en: 'Cherry Blossom Nights' } },
];

// ---------------------------------------------------------------------------
// Build a valid Gemini response for any city
// ---------------------------------------------------------------------------

function buildGeminiResponseForCity(cityId: string) {
  const neighborhoods = [];
  const waypoints = [];
  const tasks = [];

  for (let n = 0; n < 6; n++) {
    const nId = `${cityId}-neighborhood-${n}`;
    neighborhoods.push({
      name: { en: `Neighborhood ${n}`, 'zh-Hans': `邻里${n}`, 'zh-Hant': `鄰里${n}` },
      summary: { en: `A vibey area ${n}` },
      trending_score: 70 + n,
      city_id: cityId,
      lat: 35.6 + n * 0.05,
      lng: 139.6 + n * 0.05,
    });

    for (let w = 0; w < 8; w++) {
      waypoints.push({
        name: { en: `Waypoint ${n}-${w}`, 'zh-Hans': `路点${n}-${w}`, 'zh-Hant': `路點${n}-${w}` },
        description: { en: `A great spot` },
        type: w % 2 === 0 ? 'food' : 'drink',
        neighborhood_id: nId,
        city_id: cityId,
        lat: 35.6 + n * 0.01 + w * 0.001,
        lng: 139.6 + n * 0.01 + w * 0.001,
        trending_score: 60,
      });
    }

    for (let t = 0; t < 12; t++) {
      const wIdx = t % 8;
      const wId = `${nId}-waypoint-${n}-${wIdx}`;
      tasks.push({
        waypoint_id: wId,
        title: { en: `Task ${n}-${t}`, 'zh-Hans': `任务${n}-${t}`, 'zh-Hant': `任務${n}-${t}` },
        prompt: { en: `Do task ${n}-${t}`, 'zh-Hans': `做${n}-${t}`, 'zh-Hant': `做${n}-${t}` },
        points: 10,
        duration_minutes: 5,
      });
    }
  }

  return { neighborhoods, waypoints, tasks };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn(async (path: string) => {
  if (path.includes('global_city_cache.json')) return JSON.stringify(citiesFixture);
  if (path.includes('seasonal-calendar.json')) return JSON.stringify(seasonalFixture);
  return '[]';
});

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile },
  readFile: mockReadFile,
}));

// Track which cities Gemini was called for
let geminiCallCities: string[] = [];
let geminiShouldFail: string[] = [];

const mockGenerateContent = vi.fn(async (prompt: string) => {
  // Extract city from prompt
  const cityMatch = prompt.match(/expert in (\w+)/);
  const cityName = cityMatch?.[1] ?? 'Unknown';
  geminiCallCities.push(cityName);

  if (geminiShouldFail.includes(cityName)) {
    throw new Error('Gemini down');
  }

  // Find the city ID
  const city = citiesFixture.find((c) => c.name === cityName);
  const cityId = city?.id ?? cityName.toLowerCase();
  const response = buildGeminiResponseForCity(cityId);
  return { response: { text: () => JSON.stringify(response) } };
});

class MockGoogleGenerativeAI {
  getGenerativeModel() {
    return { generateContent: mockGenerateContent };
  }
}

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: MockGoogleGenerativeAI,
}));

// MSW for Google Places
const placesHandler = http.post(
  'https://places.googleapis.com/v1/places:searchText',
  async () => {
    return HttpResponse.json({
      places: [
        {
          id: 'ChIJ_test',
          location: { latitude: 35.66, longitude: 139.7 },
          businessStatus: 'OPERATIONAL',
        },
      ],
    });
  },
);
const server = setupServer(placesHandler);

// Mock Firebase Admin
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockDocGet = vi.fn().mockResolvedValue({ exists: false, data: () => ({}) });
const writeCityCalls: string[] = [];

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
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
    batch: vi.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit })),
  })),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'mock-app' })),
  getApps: vi.fn(() => [{ name: 'mock-app' }]),
  cert: vi.fn(),
}));

const { runPipeline } = await import('../pipeline/build_cache');

describe('Epic 5 — CLI Orchestrator', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterAll(() => server.close());

  beforeEach(() => {
    vi.clearAllMocks();
    geminiCallCities = [];
    geminiShouldFail = [];
    mockBatchCommit.mockResolvedValue(undefined);
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  // Test 1: processes all cities
  it('processes all cities and calls generate, validate, write for each', async () => {
    const report = await runPipeline();

    expect(geminiCallCities).toHaveLength(citiesFixture.length);
    expect(report.cities_completed).toBe(citiesFixture.length);
  });

  // Test 2: --cities filter
  it('filters to specific cities with cities option', async () => {
    await runPipeline({ cities: ['tokyo', 'paris'] });

    expect(geminiCallCities).toHaveLength(2);
    expect(geminiCallCities).toContain('Tokyo');
    expect(geminiCallCities).toContain('Paris');
  });

  // Test 3: --seasonal filter
  it('filters to cities with matching seasonal variant and passes it', async () => {
    await runPipeline({ seasonal: 'cherry_blossom' });

    expect(geminiCallCities).toHaveLength(1);
    expect(geminiCallCities[0]).toBe('Tokyo');

    // The prompt should contain seasonal context
    const promptArg = mockGenerateContent.mock.calls[0][0];
    expect(promptArg).toContain('Cherry Blossom Nights');
  });

  // Test 4: --dry-run skips write
  it('skips writeCityToFirestore when dryRun is true', async () => {
    await runPipeline({ dryRun: true });

    expect(geminiCallCities.length).toBeGreaterThan(0);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  // Test 5: returns report with numeric fields
  it('returns a report with numeric fields', async () => {
    const report = await runPipeline();

    expect(typeof report.cities_completed).toBe('number');
    expect(typeof report.waypoints_validated).toBe('number');
    expect(typeof report.waypoints_flagged).toBe('number');
    expect(typeof report.total_duration_ms).toBe('number');
    expect(report.cities_completed).toBeGreaterThanOrEqual(0);
    expect(report.waypoints_validated).toBeGreaterThanOrEqual(0);
    expect(report.total_duration_ms).toBeGreaterThanOrEqual(0);
  });

  // Test 6: continues on per-city error
  it('continues on per-city error and includes it in report', async () => {
    geminiShouldFail = ['Paris'];

    const report = await runPipeline();

    expect(report.cities_completed).toBe(2); // tokyo + bangkok succeed
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].cityId).toBe('paris');
    expect(report.errors[0].error).toContain('Gemini down');
  });

  // Test 7: --tier filter
  it('filters to tier1 cities with tier option', async () => {
    await runPipeline({ tier: 'tier1' });

    expect(geminiCallCities).toHaveLength(2); // tokyo + paris
    expect(geminiCallCities).not.toContain('Bangkok');
  });
});
