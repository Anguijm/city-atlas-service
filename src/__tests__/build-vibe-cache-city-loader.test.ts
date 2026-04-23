import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { City, SeasonalVariant } from '@/schemas/cityAtlas';
import { CitySchema, SeasonalVariantSchema } from '@/schemas/cityAtlas';

// ---------------------------------------------------------------------------
// Mock fs/promises — return fixture JSON from readFile
// ---------------------------------------------------------------------------

const citiesFixture: City[] = [
  {
    id: 'tokyo',
    name: 'Tokyo',
    country: 'Japan',
    region: 'asia-pacific',
    lat: 35.6762,
    lng: 139.6503,
    tier: 'tier1',
  },
  {
    id: 'paris',
    name: 'Paris',
    country: 'France',
    region: 'europe',
    lat: 48.8566,
    lng: 2.3522,
    tier: 'tier1',
  },
];

const seasonalFixture: SeasonalVariant[] = [
  {
    id: 'tokyo-cherry-blossom',
    city_id: 'tokyo',
    season_key: 'cherry_blossom',
    starts_at: '2026-03-15',
    ends_at: '2026-04-20',
    title: { en: 'Cherry Blossom Nights' },
  },
  {
    id: 'paris-christmas',
    city_id: 'paris',
    season_key: 'christmas',
    starts_at: '2026-11-28',
    ends_at: '2027-01-02',
    title: { en: 'Noël City Hunt' },
  },
];

const mockReadFile = vi.fn(async (path: string) => {
  if (path.includes('global_city_cache.json')) {
    return JSON.stringify(citiesFixture);
  }
  if (path.includes('seasonal-calendar.json')) {
    return JSON.stringify(seasonalFixture);
  }
  throw new Error(`File not found: ${path}`);
});

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile },
  readFile: mockReadFile,
}));

// Import after mocks are set up
const {
  loadCities,
  loadSeasonalCalendar,
  getSeasonalVariantsForCity,
  getActiveSeasonalVariant,
  VibeCacheError,
} = await import('../pipeline/build_cache');

describe('Epic 1 — City Loader & Seasonal Calendar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: loadCities returns validated City objects
  it('loadCities() returns an array of City objects from global_city_cache.json', async () => {
    const cities = await loadCities();

    expect(cities).toHaveLength(citiesFixture.length);
    for (const city of cities) {
      expect(() => CitySchema.parse(city)).not.toThrow();
      expect(city).toHaveProperty('id');
      expect(city).toHaveProperty('name');
      expect(city).toHaveProperty('country');
      expect(city).toHaveProperty('region');
      expect(city).toHaveProperty('lat');
      expect(city).toHaveProperty('lng');
      expect(city).toHaveProperty('tier');
    }
  });

  // Test 2: loadCities throws on invalid data (missing id)
  it('loadCities() throws VibeCacheError(INVALID_CITY_DATA) when entry is missing id', async () => {
    const invalidData = [{ name: 'Bad City', country: 'X', region: 'y', lat: 0, lng: 0, tier: 'tier1' }];
    mockReadFile.mockResolvedValueOnce(JSON.stringify(invalidData));

    await expect(loadCities()).rejects.toThrow(VibeCacheError);

    mockReadFile.mockResolvedValueOnce(JSON.stringify(invalidData));
    await expect(loadCities()).rejects.toMatchObject({ code: 'INVALID_CITY_DATA' });
  });

  // Test 3: loadSeasonalCalendar returns validated SeasonalVariant objects
  it('loadSeasonalCalendar() returns an array of SeasonalVariant objects', async () => {
    const calendar = await loadSeasonalCalendar();

    expect(calendar).toHaveLength(seasonalFixture.length);
    for (const variant of calendar) {
      expect(() => SeasonalVariantSchema.parse(variant)).not.toThrow();
      expect(variant).toHaveProperty('id');
      expect(variant).toHaveProperty('city_id');
      expect(variant).toHaveProperty('season_key');
      expect(variant).toHaveProperty('starts_at');
      expect(variant).toHaveProperty('ends_at');
      expect(variant).toHaveProperty('title');
    }
  });

  // Test 4: loadSeasonalCalendar throws on invalid data (missing city_id)
  it('loadSeasonalCalendar() throws VibeCacheError(INVALID_SEASONAL_DATA) when entry is missing city_id', async () => {
    const invalidData = [{ id: 'bad', season_key: 'x', starts_at: 'a', ends_at: 'b', title: { en: 'X' } }];
    mockReadFile.mockResolvedValueOnce(JSON.stringify(invalidData));

    await expect(loadSeasonalCalendar()).rejects.toThrow(VibeCacheError);

    mockReadFile.mockResolvedValueOnce(JSON.stringify(invalidData));
    await expect(loadSeasonalCalendar()).rejects.toMatchObject({
      code: 'INVALID_SEASONAL_DATA',
    });
  });

  // Test 5: getSeasonalVariantsForCity filters by city_id
  it('getSeasonalVariantsForCity("tokyo") returns only tokyo variants', () => {
    const tokyoVariants = getSeasonalVariantsForCity('tokyo', seasonalFixture);

    expect(tokyoVariants).toHaveLength(1);
    expect(tokyoVariants[0].city_id).toBe('tokyo');
    expect(tokyoVariants[0].season_key).toBe('cherry_blossom');
  });

  // Test 6: getActiveSeasonalVariant returns matching variant or null
  it('getActiveSeasonalVariant() returns cherry blossom for date within range, null outside', () => {
    const active = getActiveSeasonalVariant('tokyo', '2026-03-20', seasonalFixture);
    expect(active).not.toBeNull();
    expect(active!.season_key).toBe('cherry_blossom');

    const inactive = getActiveSeasonalVariant('tokyo', '2026-01-15', seasonalFixture);
    expect(inactive).toBeNull();
  });
});
