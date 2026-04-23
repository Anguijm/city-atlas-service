#!/usr/bin/env npx tsx
/**
 * Global Vibe Cache — Baseline Build Pipeline
 *
 * Generates neighborhoods, waypoints, and photo tasks for 100 cities via Gemini,
 * validates each waypoint against the Google Places API, and batch-writes the
 * validated data to Firestore.
 *
 * Usage:
 *   npx tsx src/pipeline/build_cache.ts
 *   npx tsx src/pipeline/build_cache.ts --cities tokyo,paris
 *   npx tsx src/pipeline/build_cache.ts --tier tier1
 *   npx tsx src/pipeline/build_cache.ts --seasonal cherry_blossom
 *   npx tsx src/pipeline/build_cache.ts --dry-run
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import {
  CitySchema,
  SeasonalVariantSchema,
  NeighborhoodSchema,
  WaypointSchema,
  TaskSchema,
  LOCALIZATION_TARGETS,
  type City,
  type SeasonalVariant,
  type Neighborhood,
  type Waypoint,
  type Task,
  type LocalizedText,
} from '../schemas/cityAtlas';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class VibeCacheError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'VibeCacheError';
  }
}

// ---------------------------------------------------------------------------
// Regional Source Map (GLOBAL_VIBE_CACHE_SPEC.md §2.1)
// ---------------------------------------------------------------------------

export const REGIONAL_SOURCE_MAP: Record<string, Record<string, string>> = {
  'asia-pacific': {
    Japan: 'Tabelog',
    'South Korea': 'Naver Place',
    Thailand: 'Wongnai',
    China: 'Dianping',
    India: 'Zomato',
    Singapore: 'Google Maps + Burpple',
    Australia: 'Zomato AU + Broadsheet',
    'New Zealand': 'Zomato AU + Broadsheet',
    _default: 'Google Maps',
  },
  europe: {
    France: 'Google Maps + TheFork',
    Italy: 'Google Maps + TheFork',
    Spain: 'Google Maps + TheFork',
    Germany: 'Google Maps + TheFork',
    UK: 'Google Maps + TimeOut',
    _default: 'Google Maps + TripAdvisor',
  },
  americas: {
    Brazil: 'Google Maps + iFood',
    _default: 'Google Maps + Yelp',
  },
  'middle-east': {
    _default: 'Google Maps + Zomato',
  },
  africa: {
    _default: 'Google Maps + TripAdvisor',
  },
};

/**
 * Resolve the regional data source name for a city.
 */
export function getRegionalSource(city: City): string {
  const regionMap = REGIONAL_SOURCE_MAP[city.region];
  if (!regionMap) return 'Google Maps';
  return regionMap[city.country] ?? regionMap._default ?? 'Google Maps';
}

// ---------------------------------------------------------------------------
// Epic 1 — City Loader & Seasonal Calendar
// ---------------------------------------------------------------------------

/**
 * Load and validate the top-100 cities list.
 * @throws {VibeCacheError} INVALID_CITY_DATA when any entry fails validation.
 */
export async function loadCities(): Promise<City[]> {
  const filePath = resolve(__dirname, '../../configs/global_city_cache.json');
  const raw = await readFile(filePath, 'utf-8');
  const data: unknown[] = JSON.parse(raw);

  return data.map((entry, i) => {
    const result = CitySchema.safeParse(entry);
    if (!result.success) {
      throw new VibeCacheError(
        'INVALID_CITY_DATA',
        `City at index ${i} failed validation: ${result.error.message}`,
      );
    }
    return result.data;
  });
}

/**
 * Load and validate the seasonal calendar.
 * @throws {VibeCacheError} INVALID_SEASONAL_DATA when any entry fails validation.
 */
export async function loadSeasonalCalendar(): Promise<SeasonalVariant[]> {
  const filePath = resolve(__dirname, '../../configs/seasonal-calendar.json');
  const raw = await readFile(filePath, 'utf-8');
  const data: unknown[] = JSON.parse(raw);

  return data.map((entry, i) => {
    const result = SeasonalVariantSchema.safeParse(entry);
    if (!result.success) {
      throw new VibeCacheError(
        'INVALID_SEASONAL_DATA',
        `Seasonal variant at index ${i} failed validation: ${result.error.message}`,
      );
    }
    return result.data;
  });
}

/**
 * Get all seasonal variants for a specific city.
 */
export function getSeasonalVariantsForCity(
  cityId: string,
  calendar: SeasonalVariant[],
): SeasonalVariant[] {
  return calendar.filter((v) => v.city_id === cityId);
}

/**
 * Get the active seasonal variant for a city on a given date, or null.
 */
export function getActiveSeasonalVariant(
  cityId: string,
  dateIso: string,
  calendar: SeasonalVariant[],
): SeasonalVariant | null {
  const variants = getSeasonalVariantsForCity(cityId, calendar);
  return (
    variants.find((v) => dateIso >= v.starts_at && dateIso <= v.ends_at) ?? null
  );
}

// ---------------------------------------------------------------------------
// Epic 2 — Gemini Generation Pipeline
// ---------------------------------------------------------------------------

/**
 * Build the generation prompt for a city.
 */
export function buildGenerationPrompt(
  city: City,
  regionalSource: string,
  seasonalContext?: string,
): string {
  const lines = [
    `You are Urban Explorer's local food & culture expert in ${city.name}, ${city.country}.`,
    `Using knowledge equivalent to ${regionalSource} (e.g., Tabelog for Tokyo),`,
    `identify 6 vibey neighborhoods. For each neighborhood, provide:`,
    `- name (in English + Chinese Simplified + Chinese Traditional)`,
    `- vibe_tags (array of 3-5 descriptive tags)`,
    `- lat/lng estimate for the neighborhood center`,
    `- trending_score (0-100, how popular/buzzy the area is)`,
    `- one-line summary description`,
    `- 8 places/waypoints total per neighborhood:`,
    `  - 2 cafés/drink spots (type: "drink")`,
    `  - 2 restaurants/food spots (type: "food")`,
    `  - 4 other interesting spots: landmarks, culture, hidden gems, street art, viewpoints, etc.`,
    `- 12 photo scavenger hunt tasks tied to neighborhood character (with title, prompt, points, duration_minutes)`,
    ``,
    `CRITICAL: No chains or franchises allowed. Only independent, locally-owned establishments.`,
    `Do NOT include Starbucks, McDonald's, Subway, KFC, Pret A Manger, Sukiya, Yoshinoya,`,
    `or any other national/international chain. Every spot must be a unique local business.`,
    ``,
    `Respond as a single JSON object with this structure:`,
    `{`,
    `  "neighborhoods": [{ "id": "", "city_id": "${city.id}", "name": { "en": "", "zh-Hans": "", "zh-Hant": "" }, "summary": { "en": "" }, "lat": 0, "lng": 0, "trending_score": 0 }],`,
    `  "waypoints": [{ "id": "", "city_id": "${city.id}", "neighborhood_id": "", "name": { "en": "", "zh-Hans": "", "zh-Hant": "" }, "description": { "en": "" }, "type": "food|drink|landmark|nature|culture|shopping|nightlife|viewpoint|hidden_gem", "lat": 0, "lng": 0, "trending_score": 0 }],`,
    `  "tasks": [{ "id": "", "waypoint_id": "", "title": { "en": "", "zh-Hans": "", "zh-Hant": "" }, "prompt": { "en": "", "zh-Hans": "", "zh-Hant": "" }, "points": 10, "duration_minutes": 5 }]`,
    `}`,
  ];

  if (seasonalContext) {
    lines.push('', `Seasonal context: ${seasonalContext}`);
  }

  return lines.join('\n');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Generate the vibe cache data for a single city using Gemini.
 * @throws {VibeCacheError} GEMINI_PARSE_FAILED on invalid response
 * @throws {VibeCacheError} GEMINI_API_ERROR on API failure after retry
 */
export async function generateCityCache(
  city: City,
  seasonalVariant?: SeasonalVariant,
  preParsed?: { neighborhoods?: unknown[]; waypoints?: unknown[]; tasks?: unknown[] },
): Promise<{
  neighborhoods: Neighborhood[];
  waypoints: Waypoint[];
  tasks: Task[];
}> {
  let parsed: { neighborhoods?: unknown[]; waypoints?: unknown[]; tasks?: unknown[] };

  if (preParsed) {
    // Pre-parsed JSON from file (NotebookLM pipeline)
    console.log(`  Using pre-generated JSON input`);
    parsed = preParsed;
  } else {
    // Generate via Gemini API
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const regionalSource = getRegionalSource(city);
    const seasonalContext = seasonalVariant
      ? `It is ${seasonalVariant.title.en} season (${seasonalVariant.season_key}). Incorporate seasonal elements into neighborhood selections and tasks.`
      : undefined;
    const prompt = buildGenerationPrompt(city, regionalSource, seasonalContext);

    let responseText: string;
    try {
      responseText = await callGeminiWithRetry(model, prompt);
    } catch (err) {
      throw new VibeCacheError(
        'GEMINI_API_ERROR',
        `Gemini API failed for ${city.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Parse JSON from response
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object found in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new VibeCacheError(
        'GEMINI_PARSE_FAILED',
        `Failed to parse Gemini JSON response for ${city.id}`,
      );
    }
  }

  if (
    !parsed.neighborhoods ||
    !parsed.waypoints ||
    !parsed.tasks
  ) {
    throw new VibeCacheError(
      'GEMINI_PARSE_FAILED',
      `Missing required fields in ${preParsed ? 'input file' : 'Gemini response'} for ${city.id}`,
    );
  }

  // Validate and assign deterministic IDs
  // Build a map from Gemini's raw neighborhood IDs → our slugified IDs
  const geminiIdToSlugId = new Map<string, string>();
  const neighborhoods: Neighborhood[] = (parsed.neighborhoods as unknown[]).map(
    (n: unknown, i: number) => {
      const raw = n as Record<string, unknown>;
      const geminiId = raw.id as string | undefined;
      const name = (raw.name as { en?: string })?.en ?? `neighborhood-${i}`;
      const id = slugify(`${city.id}-${name}`);
      // Map Gemini's raw ID and name variants to our deterministic ID
      if (geminiId) geminiIdToSlugId.set(geminiId, id);
      geminiIdToSlugId.set(name.toLowerCase(), id);
      geminiIdToSlugId.set(slugify(name), id);
      // Strip extra keys Gemini may return (vibe_tags, etc.) before strict validation
      const { vibe_tags: _vt, ...cleanRaw } = raw;
      const entry = { ...cleanRaw, id, city_id: city.id };
      const result = NeighborhoodSchema.safeParse(entry);
      if (!result.success) {
        throw new VibeCacheError(
          'GEMINI_PARSE_FAILED',
          `Neighborhood validation failed: ${result.error.message}`,
        );
      }
      return result.data;
    },
  );

  // Map Gemini's freeform types to our enum values
  const TYPE_MAP: Record<string, string> = {
    cafe: 'drink', coffee: 'drink', bar: 'drink', tea: 'drink', bakery: 'food',
    restaurant: 'food', eatery: 'food', street_food: 'food',
    museum: 'culture', gallery: 'culture', temple: 'culture', shrine: 'culture',
    church: 'culture', mosque: 'culture', theater: 'culture', theatre: 'culture',
    park: 'nature', garden: 'nature', beach: 'nature', river: 'nature',
    market: 'shopping', shop: 'shopping', boutique: 'shopping', mall: 'shopping',
    art: 'culture', street_art: 'culture', mural: 'culture',
    rooftop: 'viewpoint', observation: 'viewpoint', tower: 'viewpoint',
    historic: 'landmark', monument: 'landmark', statue: 'landmark', bridge: 'landmark',
    club: 'nightlife', lounge: 'nightlife', live_music: 'nightlife',
    secret: 'hidden_gem', offbeat: 'hidden_gem', unusual: 'hidden_gem',
  };

  const waypoints: Waypoint[] = (parsed.waypoints as unknown[]).map(
    (w: unknown, i: number) => {
      const raw = w as Record<string, unknown>;
      const rawNeighborhoodId = raw.neighborhood_id as string;
      // Resolve Gemini's neighborhood_id to our deterministic slug
      // Gemini may return "shimokitazawa", "n01", "tokyo-shimokitazawa", etc.
      const neighborhoodId =
        geminiIdToSlugId.get(rawNeighborhoodId) ??
        geminiIdToSlugId.get(slugify(rawNeighborhoodId)) ??
        geminiIdToSlugId.get(rawNeighborhoodId.toLowerCase()) ??
        (rawNeighborhoodId.startsWith(`${city.id}-`) ? rawNeighborhoodId : slugify(`${city.id}-${rawNeighborhoodId}`));
      const name = (raw.name as { en?: string })?.en ?? `waypoint-${i}`;
      const id = slugify(`${neighborhoodId}-${name}`);
      // Normalize type to our enum — fall back to 'landmark' for any unmapped type
      const rawType = String(raw.type || 'landmark').toLowerCase();
      const VALID_TYPES = new Set(['landmark', 'food', 'drink', 'nature', 'culture', 'shopping', 'nightlife', 'viewpoint', 'hidden_gem']);
      const mapped = TYPE_MAP[rawType] || rawType;
      const normalizedType = VALID_TYPES.has(mapped) ? mapped : 'landmark';
      // Default trending_score if Gemini omits it
      if (raw.trending_score === undefined || raw.trending_score === null) {
        raw.trending_score = 50;
      }
      const entry = { ...raw, id, city_id: city.id, neighborhood_id: neighborhoodId, type: normalizedType };
      const result = WaypointSchema.safeParse(entry);
      if (!result.success) {
        throw new VibeCacheError(
          'GEMINI_PARSE_FAILED',
          `Waypoint validation failed: ${result.error.message}`,
        );
      }
      return result.data;
    },
  );

  // Build raw→slug map for waypoint IDs so tasks can reference resolved IDs
  const rawWaypointIdToSlug = new Map<string, string>();
  (parsed.waypoints as unknown[]).forEach((w: unknown, i: number) => {
    const raw = w as Record<string, unknown>;
    const rawId = raw.id as string;
    if (rawId && waypoints[i]) {
      rawWaypointIdToSlug.set(rawId, waypoints[i].id);
      rawWaypointIdToSlug.set(rawId.toLowerCase(), waypoints[i].id);
      rawWaypointIdToSlug.set(slugify(rawId), waypoints[i].id);
    }
  });

  // Clean localized text fields — strip typos/invalid locale keys from Gemini output
  const VALID_LOCALES = new Set(['en', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'th']);
  function cleanLocalizedFields(obj: Record<string, unknown>): Record<string, unknown> {
    const cleaned = { ...obj };
    for (const [key, val] of Object.entries(cleaned)) {
      if (val && typeof val === 'object' && !Array.isArray(val) && 'en' in (val as Record<string, unknown>)) {
        const locObj = val as Record<string, unknown>;
        const stripped: Record<string, unknown> = {};
        for (const [locale, text] of Object.entries(locObj)) {
          if (VALID_LOCALES.has(locale)) stripped[locale] = text;
        }
        cleaned[key] = stripped;
      }
    }
    return cleaned;
  }

  const tasks: Task[] = ((parsed.tasks as unknown[]).map(
    (t: unknown, i: number) => {
      const raw = cleanLocalizedFields(t as Record<string, unknown>);
      // Resolve raw waypoint_id to our slugified ID
      const rawWpId = (raw.waypoint_id as string) || '';
      const waypointId =
        rawWaypointIdToSlug.get(rawWpId) ??
        rawWaypointIdToSlug.get(rawWpId.toLowerCase()) ??
        rawWaypointIdToSlug.get(slugify(rawWpId)) ??
        (waypoints[0]?.id ?? `${city.id}-unknown-wp`);
      const id = slugify(`${waypointId}-task-${i}`);
      const TASK_KEYS = new Set(['id', 'waypoint_id', 'title', 'prompt', 'points', 'duration_minutes']);
      const stripped: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (TASK_KEYS.has(k)) stripped[k] = v;
      }
      // Default title/prompt if Gemini omits them
      if (!stripped.title) stripped.title = { en: `Photo task ${i + 1}` };
      if (!stripped.prompt) stripped.prompt = { en: `Take a creative photo at this location.` };
      if (!stripped.points) stripped.points = 10;
      const entry = { ...stripped, id, waypoint_id: waypointId };
      const result = TaskSchema.safeParse(entry);
      if (!result.success) {
        // Skip invalid tasks instead of crashing the entire city
        console.warn(`    ⚠ Skipping invalid task ${i}: ${result.error.issues[0]?.message}`);
        return null;
      }
      return result.data;
    },
  ) as (Task | null)[]).filter((t): t is Task => t !== null);

  return { neighborhoods, waypoints, tasks };
}

async function callGeminiWithRetry(
  model: { generateContent: (prompt: string) => Promise<{ response: { text: () => string } }> },
  prompt: string,
  maxRetries = 1,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err: unknown) {
      lastError = err;
      const status =
        err instanceof Error && 'status' in err
          ? (err as { status: number }).status
          : 0;
      if ((status === 429 || status === 503) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Epic 3 — Google Places Validation
// ---------------------------------------------------------------------------

export type ValidationStatus = 'VALIDATED' | 'NOT_FOUND' | 'CLOSED';

export type ValidatedWaypoint = Waypoint & {
  google_place_id?: string;
  business_status?: string;
  validation_status: ValidationStatus;
  last_validated?: string;
};

export type ValidationReport = {
  validated: ValidatedWaypoint[];
  notFound: ValidatedWaypoint[];
  closed: ValidatedWaypoint[];
};

/**
 * Validate a single waypoint against Google Places Text Search.
 */
export async function validateWaypoint(
  waypoint: Waypoint,
  neighborhoodName: string,
  cityName: string,
): Promise<ValidatedWaypoint> {
  const textQuery = `${waypoint.name.en}, ${neighborhoodName}, ${cityName}`;
  const apiKey = process.env.GOOGLE_MAPS_KEY || '';

  try {
    const response = await withRetry(async () => {
      const res = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.location,places.businessStatus,places.rating,places.userRatingCount',
          },
          body: JSON.stringify({ textQuery, maxResultCount: 1 }),
        },
      );
      if (!res.ok) {
        const err = new Error(`Places API error: ${res.status}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      return res.json();
    }, 1, 2000);

    const places = response.places ?? [];

    if (places.length === 0) {
      return { ...waypoint, validation_status: 'NOT_FOUND' };
    }

    const place = places[0];
    const businessStatus = place.businessStatus ?? 'OPERATIONAL';

    if (businessStatus === 'CLOSED_PERMANENTLY') {
      return {
        ...waypoint,
        google_place_id: place.id,
        business_status: businessStatus,
        validation_status: 'CLOSED',
        last_validated: new Date().toISOString(),
      };
    }

    return {
      ...waypoint,
      google_place_id: place.id,
      lat: place.location?.latitude ?? waypoint.lat,
      lng: place.location?.longitude ?? waypoint.lng,
      business_status: businessStatus,
      validation_status: 'VALIDATED',
      last_validated: new Date().toISOString(),
    };
  } catch {
    return { ...waypoint, validation_status: 'NOT_FOUND' };
  }
}

/**
 * Validate all waypoints with concurrency control.
 */
export async function validateAllWaypoints(
  waypoints: Waypoint[],
  neighborhoods: Neighborhood[],
  city: City,
  concurrencyLimit = 5,
): Promise<ValidationReport> {
  const neighborhoodMap = new Map(neighborhoods.map((n) => [n.id, n]));
  const results: ValidatedWaypoint[] = [];
  let inFlight = 0;
  let index = 0;

  await new Promise<void>((resolveAll) => {
    function next() {
      if (index >= waypoints.length && inFlight === 0) {
        resolveAll();
        return;
      }

      while (inFlight < concurrencyLimit && index < waypoints.length) {
        const wp = waypoints[index++];
        const neighborhood = neighborhoodMap.get(wp.neighborhood_id);
        const neighborhoodName = neighborhood?.name.en ?? '';
        inFlight++;

        validateWaypoint(wp, neighborhoodName, city.name).then((result) => {
          results.push(result);
          inFlight--;
          next();
        });
      }
    }
    next();
  });

  return {
    validated: results.filter((r) => r.validation_status === 'VALIDATED'),
    notFound: results.filter((r) => r.validation_status === 'NOT_FOUND'),
    closed: results.filter((r) => r.validation_status === 'CLOSED'),
  };
}

// ---------------------------------------------------------------------------
// Epic 4 — Firestore Batch Writer
// ---------------------------------------------------------------------------

/**
 * Write a city's full vibe cache data to Firestore.
 * @throws {VibeCacheError} FIRESTORE_WRITE_FAILED on commit failure
 */
export async function writeCityToFirestore(
  city: City,
  neighborhoods: Neighborhood[],
  waypoints: ValidatedWaypoint[] | Waypoint[],
  tasks: Task[],
): Promise<void> {
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');

  const app = getApps().length
    ? getApps()[0]
    : process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      ? initializeApp({
          credential: cert(
            JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY),
          ),
        })
      : initializeApp();

  const db = getFirestore(app, 'urbanexplorer');

  // Check idempotency: skip if already written with same version (unless --force)
  const force = process.argv.includes('--force');
  if (!force) {
    const existingDoc = await db.collection('cities').doc(city.id).get();
    if (
      existingDoc.exists &&
      existingDoc.data()?.cache_metadata?.source_version === 'baseline_v1'
    ) {
      return;
    }
  }

  // Collect all operations
  type BatchOp = { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> };
  const ops: BatchOp[] = [];

  // City document
  const cityRef = db.collection('cities').doc(city.id);
  const cityDocData: Record<string, unknown> = {
    name: city.name,
    country: city.country,
    region: city.region,
    tier: city.tier,
    location: { latitude: city.lat, longitude: city.lng },
    cache_metadata: {
      generated_at: FieldValue.serverTimestamp(),
      source_version: 'baseline_v1',
      next_refresh: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  };
  // Coverage tier metadata (new schema fields)
  const cityExt = city as unknown as { coverageTier?: string; maxRadiusKm?: number };
  if (cityExt.coverageTier) cityDocData.coverageTier = cityExt.coverageTier;
  if (cityExt.maxRadiusKm) cityDocData.maxRadiusKm = cityExt.maxRadiusKm;
  ops.push({ ref: cityRef, data: cityDocData });

  // Neighborhood documents (subcollection + denormalized)
  for (const n of neighborhoods) {
    const subRef = db
      .collection('cities')
      .doc(city.id)
      .collection('neighborhoods')
      .doc(n.id);
    const flatRef = db.collection('vibe_neighborhoods').doc(n.id);
    const payload = {
      name: n.name,
      city_id: n.city_id,
      trending_score: n.trending_score,
      summary: n.summary,
      lat: n.lat,
      lng: n.lng,
      is_active: true,
    };
    ops.push({ ref: subRef, data: payload });
    ops.push({ ref: flatRef, data: payload });
  }

  // Waypoint documents (subcollection + denormalized)
  let skippedWaypoints = 0;
  for (const w of waypoints) {
    const neighborhood = neighborhoods.find(
      (n) => n.id === w.neighborhood_id,
    );
    if (!neighborhood) {
      if (skippedWaypoints === 0) {
        console.log(`    ⚠ Waypoint neighborhood_id mismatch: waypoint.neighborhood_id="${w.neighborhood_id}", available: [${neighborhoods.map(n=>n.id).join(', ')}]`);
      }
      skippedWaypoints++;
      continue;
    }
    const subRef = db
      .collection('cities')
      .doc(city.id)
      .collection('neighborhoods')
      .doc(w.neighborhood_id)
      .collection('waypoints')
      .doc(w.id);
    const flatRef = db.collection('vibe_waypoints').doc(w.id);
    const vw = w as ValidatedWaypoint;
    const payload = {
      name: w.name,
      city_id: w.city_id,
      neighborhood_id: w.neighborhood_id,
      type: w.type,
      lat: w.lat,
      lng: w.lng,
      trending_score: w.trending_score,
      description: w.description,
      google_place_id: vw.google_place_id ?? null,
      business_status: vw.business_status ?? null,
      is_active: true,
      last_validated: vw.last_validated ?? null,
    };
    ops.push({ ref: subRef, data: payload });
    ops.push({ ref: flatRef, data: payload });
  }
  if (skippedWaypoints > 0) console.log(`    ⚠ Skipped ${skippedWaypoints}/${waypoints.length} waypoints due to neighborhood_id mismatch`);

  // Task documents (subcollection + denormalized)
  for (const t of tasks) {
    const waypoint = waypoints.find((w) => w.id === t.waypoint_id);
    if (!waypoint) continue;
    const subRef = db
      .collection('cities')
      .doc(city.id)
      .collection('neighborhoods')
      .doc(waypoint.neighborhood_id)
      .collection('tasks')
      .doc(t.id);
    const flatRef = db.collection('vibe_tasks').doc(t.id);
    const payload = {
      waypoint_id: t.waypoint_id,
      title: t.title,
      prompt: t.prompt,
      points: t.points,
      duration_minutes: t.duration_minutes,
      order: 0,
      difficulty: 'medium',
      category: 'photo',
    };
    ops.push({ ref: subRef, data: payload });
    ops.push({ ref: flatRef, data: payload });
  }

  // Commit in batches of 500
  const waypointOps = ops.filter(o => o.ref.path.includes('vibe_waypoints'));
  const taskOps = ops.filter(o => o.ref.path.includes('vibe_tasks'));
  console.log(`    Writing ${ops.length} operations (${waypointOps.length} waypoints, ${taskOps.length} tasks) to Firestore...`);
  if (waypointOps.length > 0) console.log(`    First waypoint path: ${waypointOps[0].ref.path}`);
  await commitInBatches(ops, db);
  console.log(`    ✓ All ${ops.length} operations committed.`);
}

async function commitInBatches(
  ops: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[],
  db: FirebaseFirestore.Firestore,
): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const chunk = ops.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const op of chunk) {
      // `merge: true` preserves existing fields (vibeClass, loreAnchor,
      // vernacularName, aliases, coverageTier, maxRadiusKm) that are not
      // in the current payload. Without merge, a baseline re-ingest silently
      // deletes fields set by previous enrichment runs. Matches the merge
      // semantics in the flat-mirror write path at line ~1108.
      batch.set(op.ref, op.data, { merge: true });
    }
    try {
      await batch.commit();
    } catch (err) {
      throw new VibeCacheError(
        'FIRESTORE_WRITE_FAILED',
        `Batch commit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Epic 5 — CLI Orchestrator
// ---------------------------------------------------------------------------

export type PipelineOptions = {
  cities?: string[];
  seasonal?: string;
  dryRun?: boolean;
  tier?: string;
  localize?: boolean;
  inputFile?: string;
  skipValidation?: boolean;
};

export type PipelineReport = {
  cities_completed: number;
  waypoints_validated: number;
  waypoints_flagged: number;
  total_duration_ms: number;
  errors: { cityId: string; error: string }[];
};

/**
 * Run the full vibe cache build pipeline.
 */
export async function runPipeline(
  options: PipelineOptions = {},
): Promise<PipelineReport> {
  const startTime = Date.now();
  const allCities = await loadCities();
  const calendar = await loadSeasonalCalendar();

  let cities = allCities;

  // Filter by specific city IDs
  if (options.cities?.length) {
    cities = cities.filter((c) => options.cities!.includes(c.id));
  }

  // Filter by tier
  if (options.tier) {
    cities = cities.filter((c) => c.tier === options.tier);
  }

  // Filter by seasonal variant availability
  if (options.seasonal) {
    cities = cities.filter((c) =>
      calendar.some(
        (v) => v.city_id === c.id && v.season_key === options.seasonal,
      ),
    );
  }

  const report: PipelineReport = {
    cities_completed: 0,
    waypoints_validated: 0,
    waypoints_flagged: 0,
    total_duration_ms: 0,
    errors: [],
  };

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    try {
      console.log(
        `[${i + 1}/${cities.length}] Generating ${city.name}...`,
      );

      const seasonalVariant = options.seasonal
        ? calendar.find(
            (v) => v.city_id === city.id && v.season_key === options.seasonal,
          )
        : undefined;

      let neighborhoods: Neighborhood[];
      let waypoints: Waypoint[];
      let tasks: Task[];

      if (options.inputFile) {
        // Read from pre-generated JSON file (NotebookLM pipeline)
        const { readFileSync } = await import('fs');
        const raw = JSON.parse(readFileSync(options.inputFile, 'utf-8'));
        const result = await generateCityCache(city, seasonalVariant, raw);
        neighborhoods = result.neighborhoods;
        waypoints = result.waypoints;
        tasks = result.tasks;
      } else {
        const result = await generateCityCache(city, seasonalVariant);
        neighborhoods = result.neighborhoods;
        waypoints = result.waypoints;
        tasks = result.tasks;
      }

      const validationReport = options.skipValidation
        ? { validated: waypoints.map(w => ({ ...w })), notFound: [] as Waypoint[], closed: [] as Waypoint[] }
        : await validateAllWaypoints(waypoints, neighborhoods, city);

      report.waypoints_validated += validationReport.validated.length;
      report.waypoints_flagged +=
        validationReport.notFound.length + validationReport.closed.length;

      // Localization pass (all 7 target languages)
      if (options.localize) {
        console.log(`  Localizing ${city.name} to ${LOCALIZATION_TARGETS.length} languages...`);
        await localizeCityCache(city, neighborhoods, waypoints, tasks);
      }

      if (!options.dryRun) {
        const allValidated = [
          ...validationReport.validated,
          ...validationReport.notFound,
          ...validationReport.closed,
        ];
        await writeCityToFirestore(city, neighborhoods, allValidated, tasks);

        // Write localized fields as merge updates
        if (options.localize) {
          await writeLocalizedFieldsToFirestore(city, neighborhoods, waypoints, tasks);
        }
      }

      report.cities_completed++;
      console.log(
        `  ✓ ${neighborhoods.length} neighborhoods, ${waypoints.length} waypoints${options.localize ? ` (${LOCALIZATION_TARGETS.length} locales)` : ''}`,
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      report.errors.push({ cityId: city.id, error: errorMessage });
      console.error(`  ✗ Error processing ${city.name}: ${errorMessage}`);
    }
  }

  report.total_duration_ms = Date.now() - startTime;
  return report;
}

// ---------------------------------------------------------------------------
// Shared Utilities
// ---------------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Phase 2 — Localization Pipeline
// ---------------------------------------------------------------------------

const LOCALE_LABELS: Record<string, string> = {
  ja: 'Japanese',
  ko: 'Korean',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  es: 'Spanish',
  fr: 'French',
  th: 'Thai',
};

/**
 * Build a localization prompt for a single target language.
 */
export function buildLocalizationPrompt(
  locale: string,
  texts: { key: string; en: string }[],
): string {
  const langName = LOCALE_LABELS[locale] ?? locale;
  return [
    `Translate the following English texts into ${langName} (${locale}).`,
    `Use natural, colloquial phrasing appropriate for the locale.`,
    `For proper nouns with established local spellings, use them (e.g., 下北沢 not シモキタザワ).`,
    ``,
    `Return a JSON object mapping each key to its translated string:`,
    `{`,
    ...texts.map((t) => `  "${t.key}": "translation of: ${t.en}",`),
    `}`,
  ].join('\n');
}

/**
 * Extract all localizable text fields from neighborhoods, waypoints, and tasks.
 */
export function extractLocalizableTexts(
  neighborhoods: Neighborhood[],
  waypoints: Waypoint[],
  tasks: Task[],
): { key: string; en: string }[] {
  const texts: { key: string; en: string }[] = [];

  for (const n of neighborhoods) {
    texts.push({ key: `n:${n.id}:name`, en: n.name.en });
    if (n.summary?.en) texts.push({ key: `n:${n.id}:summary`, en: n.summary.en });
  }
  for (const w of waypoints) {
    texts.push({ key: `w:${w.id}:name`, en: w.name.en });
    if (w.description?.en) texts.push({ key: `w:${w.id}:description`, en: w.description.en });
  }
  for (const t of tasks) {
    texts.push({ key: `t:${t.id}:title`, en: t.title.en });
    texts.push({ key: `t:${t.id}:prompt`, en: t.prompt.en });
  }

  return texts;
}

/**
 * Apply translated texts back into the data structures.
 */
export function applyTranslations(
  locale: string,
  translations: Record<string, string>,
  neighborhoods: Neighborhood[],
  waypoints: Waypoint[],
  tasks: Task[],
): void {
  for (const n of neighborhoods) {
    const nameKey = `n:${n.id}:name`;
    const summaryKey = `n:${n.id}:summary`;
    if (translations[nameKey]) (n.name as Record<string, string>)[locale] = translations[nameKey];
    if (translations[summaryKey] && n.summary) (n.summary as Record<string, string>)[locale] = translations[summaryKey];
  }
  for (const w of waypoints) {
    const nameKey = `w:${w.id}:name`;
    const descKey = `w:${w.id}:description`;
    if (translations[nameKey]) (w.name as Record<string, string>)[locale] = translations[nameKey];
    if (translations[descKey] && w.description) (w.description as Record<string, string>)[locale] = translations[descKey];
  }
  for (const t of tasks) {
    const titleKey = `t:${t.id}:title`;
    const promptKey = `t:${t.id}:prompt`;
    if (translations[titleKey]) (t.title as Record<string, string>)[locale] = translations[titleKey];
    if (translations[promptKey]) (t.prompt as Record<string, string>)[locale] = translations[promptKey];
  }
}

/**
 * Localize a city's cache data for all target languages via Gemini.
 */
export async function localizeCityCache(
  city: City,
  neighborhoods: Neighborhood[],
  waypoints: Waypoint[],
  tasks: Task[],
): Promise<void> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const texts = extractLocalizableTexts(neighborhoods, waypoints, tasks);
  if (texts.length === 0) return;

  // Batch in chunks of 50 to avoid prompt length issues
  const BATCH_SIZE = 50;

  for (const locale of LOCALIZATION_TARGETS) {
    console.log(`    Localizing to ${LOCALE_LABELS[locale]} (${locale})...`);

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const prompt = buildLocalizationPrompt(locale, batch);

      try {
        const responseText = await callGeminiWithRetry(model, prompt);
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;

        const translations = JSON.parse(jsonMatch[0]) as Record<string, string>;
        applyTranslations(locale, translations, neighborhoods, waypoints, tasks);
      } catch (err) {
        console.warn(`    ⚠ Locale ${locale} batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

/**
 * Write localized field updates to Firestore (merge, not overwrite).
 */
export async function writeLocalizedFieldsToFirestore(
  city: City,
  neighborhoods: Neighborhood[],
  waypoints: Waypoint[],
  tasks: Task[],
): Promise<void> {
  const { getFirestore } = await import('firebase-admin/firestore');
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');

  const app = getApps().length
    ? getApps()[0]
    : process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      ? initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) })
      : initializeApp();

  const db = getFirestore(app, 'urbanexplorer');

  type MergeOp = { ref: FirebaseFirestore.DocumentReference; data: Record<string, LocalizedText> };
  const ops: MergeOp[] = [];

  // Dual-write: flat collection + subcollection (mirrors writeCityToFirestore)
  for (const n of neighborhoods) {
    const payload = { name: n.name, ...(n.summary ? { summary: n.summary } : {}) };
    const flatRef = db.collection('vibe_neighborhoods').doc(n.id);
    const subRef = db.collection('cities').doc(city.id).collection('neighborhoods').doc(n.id);
    ops.push({ ref: flatRef, data: payload });
    ops.push({ ref: subRef, data: payload });
  }
  for (const w of waypoints) {
    const payload = { name: w.name, ...(w.description ? { description: w.description } : {}) };
    const flatRef = db.collection('vibe_waypoints').doc(w.id);
    const subRef = db.collection('cities').doc(city.id)
      .collection('neighborhoods').doc(w.neighborhood_id)
      .collection('waypoints').doc(w.id);
    ops.push({ ref: flatRef, data: payload });
    ops.push({ ref: subRef, data: payload });
  }
  for (const t of tasks) {
    const payload = { title: t.title, prompt: t.prompt };
    const wp = waypoints.find((w) => w.id === t.waypoint_id);
    if (!wp) continue;
    const flatRef = db.collection('vibe_tasks').doc(t.id);
    const subRef = db.collection('cities').doc(city.id)
      .collection('neighborhoods').doc(wp.neighborhood_id)
      .collection('tasks').doc(t.id);
    ops.push({ ref: flatRef, data: payload });
    ops.push({ ref: subRef, data: payload });
  }

  // Merge in batches of 500 (Firestore batch limit)
  const BATCH_SIZE = 500;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const chunk = ops.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const op of chunk) {
      batch.set(op.ref, op.data, { merge: true });
    }
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  const options: PipelineOptions = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--cities':
        options.cities = args[++i]?.split(',');
        break;
      case '--seasonal':
        options.seasonal = args[++i];
        break;
      case '--tier':
        options.tier = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--localize':
        options.localize = true;
        break;
      case '--input':
        options.inputFile = args[++i];
        break;
      case '--skip-validation':
        options.skipValidation = true;
        break;
      case '--force':
        // Already handled in writeCityToFirestore via idempotency check
        break;
    }
  }

  // Graceful shutdown
  let shuttingDown = false;
  process.on('SIGINT', () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log('\nGraceful shutdown requested. Finishing current city...');
  });

  const report = await runPipeline(options);
  console.log('\n=== Pipeline Report ===');
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors.length > 0 ? 1 : 0);
}

// Only run main when executed directly (not imported in tests)
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
