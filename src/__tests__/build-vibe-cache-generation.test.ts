import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NeighborhoodSchema, WaypointSchema, TaskSchema } from '@/schemas/cityAtlas';
import type { City, SeasonalVariant } from '@/schemas/cityAtlas';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tokyoCity: City = {
  id: 'tokyo',
  name: 'Tokyo',
  country: 'Japan',
  region: 'asia-pacific',
  lat: 35.6762,
  lng: 139.6503,
  tier: 'tier1',
};

const cherryBlossomVariant: SeasonalVariant = {
  id: 'tokyo-cherry-blossom',
  city_id: 'tokyo',
  season_key: 'cherry_blossom',
  starts_at: '2026-03-15',
  ends_at: '2026-04-20',
  title: { en: 'Cherry Blossom Nights' },
};

function makeNeighborhood(index: number, cityId: string) {
  const name = `Neighborhood ${index}`;
  return {
    name: { en: name, 'zh-Hans': `邻里${index}`, 'zh-Hant': `鄰里${index}` },
    summary: { en: `A vibey area ${index}` },
    trending_score: 70 + index,
    city_id: cityId,
    lat: 35.6 + index * 0.05,
    lng: 139.6 + index * 0.05,
  };
}

function makeWaypoint(
  index: number,
  neighborhoodId: string,
  cityId: string,
) {
  return {
    name: { en: `Waypoint ${index}`, 'zh-Hans': `路点${index}`, 'zh-Hant': `路點${index}` },
    description: { en: `A great spot ${index}` },
    type: index % 2 === 0 ? 'food' : 'drink',
    neighborhood_id: neighborhoodId,
    city_id: cityId,
    lat: 35.6 + index * 0.01,
    lng: 139.6 + index * 0.01,
    trending_score: 50 + index,
  };
}

function makeTask(index: number, waypointId: string) {
  return {
    waypoint_id: waypointId,
    title: { en: `Task ${index}`, 'zh-Hans': `任务${index}`, 'zh-Hant': `任務${index}` },
    prompt: { en: `Take a photo of ${index}`, 'zh-Hans': `拍照${index}`, 'zh-Hant': `拍照${index}` },
    points: 10,
    duration_minutes: 5,
  };
}

function buildGeminiResponse() {
  const neighborhoods = [];
  const waypoints = [];
  const tasks = [];

  for (let n = 0; n < 6; n++) {
    const nId = `tokyo-neighborhood-${n}`;
    neighborhoods.push(makeNeighborhood(n, 'tokyo'));

    for (let w = 0; w < 8; w++) {
      const wIndex = n * 8 + w;
      const wp = makeWaypoint(wIndex, nId, 'tokyo');
      waypoints.push(wp);

      // 12 tasks per neighborhood = 2 tasks per waypoint for first 6 waypoints
    }

    for (let t = 0; t < 12; t++) {
      const tIndex = n * 12 + t;
      const wpIndex = n * 8 + (t % 8);
      const wId = `${nId}-waypoint-${wpIndex}`;
      tasks.push(makeTask(tIndex, wId));
    }
  }

  return { neighborhoods, waypoints, tasks };
}

// ---------------------------------------------------------------------------
// Mock @google/generative-ai
// ---------------------------------------------------------------------------

const mockGenerateContent = vi.fn();

class MockGoogleGenerativeAI {
  getGenerativeModel() {
    return { generateContent: mockGenerateContent };
  }
}

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: MockGoogleGenerativeAI,
}));

// Mock fs/promises for the city loader (needed by imports)
vi.mock('fs/promises', () => {
  const readFile = vi.fn(async () => JSON.stringify([]));
  return { default: { readFile }, readFile };
});

const { generateCityCache, buildGenerationPrompt, getRegionalSource, VibeCacheError } =
  await import('../pipeline/build_cache');

describe('Epic 2 — Gemini Generation Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const geminiResponse = buildGeminiResponse();
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify(geminiResponse) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: generateCityCache calls generateContent exactly once
  it('calls model.generateContent() exactly once', async () => {
    await generateCityCache(tokyoCity);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  // Test 2: prompt contains city name, region, and regional source
  it('prompt contains city name, region, and regional source (Tabelog for Japan)', async () => {
    await generateCityCache(tokyoCity);

    const promptArg = mockGenerateContent.mock.calls[0][0];
    expect(promptArg).toContain('Tokyo');
    expect(promptArg).toContain('Japan');
    expect(promptArg).toContain('Tabelog');
  });

  // Test 3: returns correct structure with expected counts
  it('returns { neighborhoods, waypoints, tasks } with 6, 48, 72 items', async () => {
    const result = await generateCityCache(tokyoCity);

    expect(result.neighborhoods).toHaveLength(6);
    expect(result.waypoints).toHaveLength(48);
    expect(result.tasks).toHaveLength(72);
  });

  // Test 4: every neighborhood passes schema validation
  it('every neighborhood passes NeighborhoodSchema.parse()', async () => {
    const result = await generateCityCache(tokyoCity);

    for (const n of result.neighborhoods) {
      expect(() => NeighborhoodSchema.parse(n)).not.toThrow();
    }
  });

  // Test 5: every waypoint passes schema validation
  it('every waypoint passes WaypointSchema.parse()', async () => {
    const result = await generateCityCache(tokyoCity);

    for (const w of result.waypoints) {
      expect(() => WaypointSchema.parse(w)).not.toThrow();
    }
  });

  // Test 6: every task passes schema validation
  it('every task passes TaskSchema.parse()', async () => {
    const result = await generateCityCache(tokyoCity);

    for (const t of result.tasks) {
      expect(() => TaskSchema.parse(t)).not.toThrow();
    }
  });

  // Test 7: throws GEMINI_PARSE_FAILED on malformed JSON
  it('throws VibeCacheError(GEMINI_PARSE_FAILED) on malformed JSON', async () => {
    const malformedMock = { response: { text: () => 'not valid json' } };
    mockGenerateContent.mockResolvedValueOnce(malformedMock);
    mockGenerateContent.mockResolvedValueOnce(malformedMock);

    await expect(generateCityCache(tokyoCity)).rejects.toThrow(VibeCacheError);
    await expect(generateCityCache(tokyoCity)).rejects.toMatchObject({ code: 'GEMINI_PARSE_FAILED' });
  });

  // Test 8: throws GEMINI_PARSE_FAILED on valid JSON but missing required fields
  it('throws VibeCacheError(GEMINI_PARSE_FAILED) on valid JSON missing required fields', async () => {
    const badResponse = {
      neighborhoods: [{ summary: { en: 'test' } }],
      waypoints: [],
      tasks: [],
    };
    const badMock = { response: { text: () => JSON.stringify(badResponse) } };
    mockGenerateContent.mockResolvedValueOnce(badMock);
    mockGenerateContent.mockResolvedValueOnce(badMock);

    await expect(generateCityCache(tokyoCity)).rejects.toThrow(VibeCacheError);
    await expect(generateCityCache(tokyoCity)).rejects.toMatchObject({ code: 'GEMINI_PARSE_FAILED' });
  });

  // Test 9: retries on 429/503, then throws GEMINI_API_ERROR
  it('retries once on 429/503, then throws VibeCacheError(GEMINI_API_ERROR)', async () => {
    const err429 = new Error('Rate limited') as Error & { status: number };
    err429.status = 429;
    mockGenerateContent.mockRejectedValue(err429);

    await expect(generateCityCache(tokyoCity)).rejects.toThrow(VibeCacheError);
    await expect(
      generateCityCache(tokyoCity),
    ).rejects.toMatchObject({ code: 'GEMINI_API_ERROR' });
    // Should have retried once (2 total calls per invocation)
    expect(mockGenerateContent).toHaveBeenCalledTimes(4); // 2 calls × 2 expect blocks
  });

  // Test 10: seasonal context included in prompt
  it('includes seasonal context in prompt when seasonal variant provided', async () => {
    await generateCityCache(tokyoCity, cherryBlossomVariant);

    const promptArg = mockGenerateContent.mock.calls[0][0];
    expect(promptArg).toContain('Cherry Blossom Nights');
    expect(promptArg).toContain('cherry_blossom');
  });

  // Test: getRegionalSource returns correct source
  it('getRegionalSource returns Tabelog for Japan/asia-pacific', () => {
    expect(getRegionalSource(tokyoCity)).toBe('Tabelog');
  });
});
