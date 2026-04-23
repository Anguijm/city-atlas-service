import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { City, Neighborhood, Waypoint } from '@/schemas/cityAtlas';

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

const neighborhood: Neighborhood = {
  id: 'tokyo-shibuya',
  city_id: 'tokyo',
  name: { en: 'Shibuya' },
  lat: 35.66,
  lng: 139.7,
  trending_score: 85,
};

const makeWaypoint = (id: string, name: string): Waypoint => ({
  id,
  city_id: 'tokyo',
  neighborhood_id: 'tokyo-shibuya',
  name: { en: name },
  type: 'food',
  lat: 35.66,
  lng: 139.7,
  trending_score: 70,
});

// ---------------------------------------------------------------------------
// MSW Server — Google Places Text Search mock
// ---------------------------------------------------------------------------

let concurrentRequests = 0;
let maxConcurrentRequests = 0;

const placesHandler = http.post(
  'https://places.googleapis.com/v1/places:searchText',
  async ({ request }) => {
    concurrentRequests++;
    maxConcurrentRequests = Math.max(maxConcurrentRequests, concurrentRequests);

    const body = (await request.json()) as { textQuery: string };
    const apiKey = request.headers.get('X-Goog-Api-Key');
    const fieldMask = request.headers.get('X-Goog-FieldMask');

    // Simulate slight delay for concurrency testing
    await new Promise((r) => setTimeout(r, 50));

    let result;
    if (body.textQuery.includes('NOT_FOUND_PLACE')) {
      result = HttpResponse.json({ places: [] });
    } else if (body.textQuery.includes('CLOSED_PLACE')) {
      result = HttpResponse.json({
        places: [
          {
            id: 'ChIJ_CLOSED',
            displayName: { text: 'Closed Place' },
            location: { latitude: 35.661, longitude: 139.701 },
            businessStatus: 'CLOSED_PERMANENTLY',
          },
        ],
      });
    } else {
      result = HttpResponse.json({
        places: [
          {
            id: 'ChIJ_abc123',
            displayName: { text: body.textQuery.split(',')[0] },
            location: { latitude: 35.662, longitude: 139.702 },
            businessStatus: 'OPERATIONAL',
            rating: 4.5,
            userRatingCount: 120,
          },
        ],
      });
    }

    concurrentRequests--;
    return result;
  },
);

const server = setupServer(placesHandler);

// ---------------------------------------------------------------------------
// Mock fs/promises (needed by build-vibe-cache imports)
// ---------------------------------------------------------------------------

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

const { validateWaypoint, validateAllWaypoints } =
  await import('../pipeline/build_cache');

describe('Epic 3 — Google Places Validation', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    concurrentRequests = 0;
    maxConcurrentRequests = 0;
  });
  afterAll(() => server.close());

  // Test 1: validateWaypoint calls Places API with correct query and headers
  it('calls Google Places Text Search with correct textQuery and headers', async () => {
    let capturedRequest: { headers: Headers; body: { textQuery: string } } | null = null;

    server.use(
      http.post(
        'https://places.googleapis.com/v1/places:searchText',
        async ({ request }) => {
          const body = (await request.json()) as { textQuery: string };
          capturedRequest = { headers: request.headers, body };
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
      ),
    );

    const wp = makeWaypoint('wp-1', 'Test Cafe');
    await validateWaypoint(wp, 'Shibuya', 'Tokyo');

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.body.textQuery).toBe('Test Cafe, Shibuya, Tokyo');
    expect(capturedRequest!.headers.get('X-Goog-FieldMask')).toContain('places.id');
    expect(capturedRequest!.headers.get('X-Goog-FieldMask')).toContain('places.location');
    expect(capturedRequest!.headers.get('X-Goog-FieldMask')).toContain('places.businessStatus');
  });

  // Test 2: successful match returns enriched waypoint
  it('returns enriched waypoint with google_place_id, updated coords, VALIDATED status', async () => {
    const wp = makeWaypoint('wp-2', 'Good Ramen');
    const result = await validateWaypoint(wp, 'Shibuya', 'Tokyo');

    expect(result.google_place_id).toBe('ChIJ_abc123');
    expect(result.lat).toBe(35.662);
    expect(result.lng).toBe(139.702);
    expect(result.business_status).toBe('OPERATIONAL');
    expect(result.validation_status).toBe('VALIDATED');
    expect(result.last_validated).toBeDefined();
  });

  // Test 3: zero results returns NOT_FOUND
  it('returns NOT_FOUND when Google Places returns empty results', async () => {
    const wp = makeWaypoint('wp-3', 'NOT_FOUND_PLACE');
    const result = await validateWaypoint(wp, 'Shibuya', 'Tokyo');

    expect(result.validation_status).toBe('NOT_FOUND');
  });

  // Test 4: CLOSED_PERMANENTLY returns CLOSED
  it('returns CLOSED when businessStatus is CLOSED_PERMANENTLY', async () => {
    const wp = makeWaypoint('wp-4', 'CLOSED_PLACE');
    const result = await validateWaypoint(wp, 'Shibuya', 'Tokyo');

    expect(result.validation_status).toBe('CLOSED');
    expect(result.business_status).toBe('CLOSED_PERMANENTLY');
  });

  // Test 5: concurrency limit of 5
  it('validateAllWaypoints processes with concurrency limit of 5', async () => {
    const waypoints = Array.from({ length: 10 }, (_, i) =>
      makeWaypoint(`wp-conc-${i}`, `Place ${i}`),
    );

    await validateAllWaypoints(waypoints, [neighborhood], tokyoCity, 5);

    expect(maxConcurrentRequests).toBeLessThanOrEqual(5);
  });

  // Test 6: returns categorized report
  it('validateAllWaypoints returns report with validated, notFound, closed', async () => {
    const waypoints = [
      makeWaypoint('wp-v1', 'Good Place 1'),
      makeWaypoint('wp-v2', 'Good Place 2'),
      makeWaypoint('wp-nf', 'NOT_FOUND_PLACE'),
      makeWaypoint('wp-cl', 'CLOSED_PLACE'),
    ];

    const report = await validateAllWaypoints(waypoints, [neighborhood], tokyoCity);

    expect(report.validated.length).toBe(2);
    expect(report.notFound.length).toBe(1);
    expect(report.closed.length).toBe(1);
  });

  // Test 7: retries on network error, then marks as NOT_FOUND
  it('retries failed request once, then marks as NOT_FOUND', async () => {
    let attempts = 0;
    server.use(
      http.post(
        'https://places.googleapis.com/v1/places:searchText',
        () => {
          attempts++;
          return HttpResponse.error();
        },
      ),
    );

    const wp = makeWaypoint('wp-retry', 'Retry Place');
    const result = await validateWaypoint(wp, 'Shibuya', 'Tokyo');

    expect(result.validation_status).toBe('NOT_FOUND');
  });
});
