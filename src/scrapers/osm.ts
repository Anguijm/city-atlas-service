#!/usr/bin/env npx tsx
/**
 * OpenStreetMap Scraper — Overpass API.
 *
 * Lists the named places OSM knows near a city: sights first, then food and
 * drink. Output feeds src/pipeline/research_city.py Phase A for small towns
 * that Wikipedia and Atlas Obscura barely cover (Grand Island, Rawlins, …).
 * OSM says a place exists and where; it does not say why it is worth a stop,
 * so it grounds names and positions, and the other sources carry the colour.
 *
 * Usage:
 *   npx tsx src/scrapers/osm.ts --city grand-island-ne   # single city
 *   npx tsx src/scrapers/osm.ts --cities a,b,c           # comma list
 *   npx tsx src/scrapers/osm.ts --interval 5000          # ms between cities (default 5000)
 *   npx tsx src/scrapers/osm.ts --dry-run                # print, don't write
 */

import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "..", "..", "data", "osm");
const CITY_CACHE = path.join(__dirname, "..", "..", "configs", "global_city_cache.json");
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// The public Overpass instance allows a couple of concurrent queries per IP
// and answers 429 when pushed; 5 s apart kept eleven towns clean.
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_RADIUS_KM = 10;
const USER_AGENT = "city-atlas-service/0.1 (+https://github.com/Anguijm/city-atlas-service; ops@anguijm.dev)";

// Lines kept per city. A town has a few dozen restaurants; past this the list
// is noise and only costs tokens.
export const MAX_PLACES = 80;

export type OsmCity = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  maxRadiusKm?: number;
};

export type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OsmPlace = {
  name: string;
  kind: string;
  lat: number;
  lng: number;
  address?: string;
  website?: string;
};

// Kinds in the order they are listed: sights before food, so the cap drops
// the fortieth diner, not the only museum.
export const KIND_ORDER = [
  "museum", "attraction", "historic site", "viewpoint", "gallery", "artwork",
  "zoo", "theme park", "park", "nature reserve", "theatre", "arts centre",
  "restaurant", "cafe", "bar", "pub", "ice cream",
] as const;

const TOURISM = ["museum", "attraction", "viewpoint", "gallery", "artwork", "zoo", "theme_park"];
const AMENITY = ["restaurant", "cafe", "bar", "pub", "theatre", "arts_centre", "ice_cream"];

export function overpassQuery(city: OsmCity): string {
  const r = Math.round((city.maxRadiusKm ?? DEFAULT_RADIUS_KM) * 1000);
  const at = `(around:${r},${city.lat},${city.lng})`;
  return (
    `[out:json][timeout:60];(` +
    `nwr${at}[name][tourism~"^(${TOURISM.join("|")})$"];` +
    `nwr${at}[name][historic];` +
    // Most town parks are a playground and a lawn; one with a wikidata link
    // is one someone thought worth writing about.
    `nwr${at}[name][leisure~"^(park|nature_reserve)$"][wikidata];` +
    `nwr${at}[name][amenity~"^(${AMENITY.join("|")})$"];` +
    `);out center tags;`
  );
}

export function kindOf(tags: Record<string, string>): string | null {
  if (tags.tourism && TOURISM.includes(tags.tourism)) return tags.tourism.replace(/_/g, " ");
  if (tags.historic) return "historic site";
  if (tags.leisure === "park" || tags.leisure === "nature_reserve") return tags.leisure.replace(/_/g, " ");
  if (tags.amenity && AMENITY.includes(tags.amenity)) return tags.amenity.replace(/_/g, " ");
  return null;
}

function addressOf(tags: Record<string, string>): string | undefined {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return street || undefined;
}

export function toPlaces(elements: OsmElement[]): OsmPlace[] {
  const seen = new Set<string>();
  const places: OsmPlace[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const kind = kindOf(tags);
    if (!name || kind === null || lat === undefined || lng === undefined) continue;
    // A building mapped as both a node and a way shows up twice.
    const key = `${name.toLowerCase()}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({ name, kind, lat, lng, address: addressOf(tags), website: tags.website });
  }
  const rank = (k: string) => {
    const i = (KIND_ORDER as readonly string[]).indexOf(k);
    return i < 0 ? KIND_ORDER.length : i;
  };
  places.sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name));
  return places.slice(0, MAX_PLACES);
}

export function buildMarkdown(city: OsmCity, places: OsmPlace[]): string {
  const lines = places.map((p) => {
    const bits = [`**${p.name}**`, p.kind];
    if (p.address) bits.push(p.address);
    bits.push(`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
    if (p.website) bits.push(p.website);
    return `- ${bits.join(" — ")}`;
  });
  return (
    `# OpenStreetMap: ${city.name}\n\n` +
    `Named places mapped in OpenStreetMap within ${city.maxRadiusKm ?? DEFAULT_RADIUS_KM} km ` +
    `of ${city.name}'s centre. Each line: name — kind — street address if mapped — ` +
    `latitude, longitude — website if mapped. A listing says the place exists; ` +
    `it says nothing about quality.\n\n` +
    lines.join("\n") + "\n"
  );
}

async function fetchElements(city: OsmCity): Promise<OsmElement[]> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: overpassQuery(city) }),
    });
    if (res.ok) return ((await res.json()) as { elements: OsmElement[] }).elements ?? [];
    if (res.status !== 429 && res.status < 500) throw new Error(`Overpass HTTP ${res.status}`);
    await sleep(attempt * 15000);
  }
  throw new Error("Overpass busy after 3 attempts");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const idxCity = args.indexOf("--city");
  const idxCities = args.indexOf("--cities");
  const idxInterval = args.indexOf("--interval");
  const dryRun = args.includes("--dry-run");

  const all = JSON.parse(fs.readFileSync(CITY_CACHE, "utf-8")) as OsmCity[];
  let ids: Set<string>;
  if (idxCity >= 0) ids = new Set([args[idxCity + 1]]);
  else if (idxCities >= 0) ids = new Set((args[idxCities + 1] || "").split(",").map((s) => s.trim()).filter(Boolean));
  else {
    console.error("Pass --city <id> or --cities a,b,c. OSM is a fallback for thin towns, not a bulk source.");
    process.exit(2);
  }
  const cities = all.filter((c) => ids.has(c.id));
  const missing = [...ids].filter((id) => !cities.some((c) => c.id === id));
  if (missing.length) console.error(`Not in the registry: ${missing.join(", ")}`);

  const interval = idxInterval >= 0 ? parseInt(args[idxInterval + 1], 10) : DEFAULT_INTERVAL_MS;
  for (const [i, city] of cities.entries()) {
    if (i > 0) await sleep(interval);
    try {
      const places = toPlaces(await fetchElements(city));
      const md = buildMarkdown(city, places);
      if (dryRun) {
        console.log(md);
      } else {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUTPUT_DIR, `${city.id}.md`), md);
      }
      console.log(`✓ ${city.id}: ${places.length} places, ${md.length} chars`);
    } catch (e) {
      console.log(`✗ ${city.id}: ${(e as Error).message}`);
    }
  }
}

// Only run CLI if invoked directly (not when imported by vitest).
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
