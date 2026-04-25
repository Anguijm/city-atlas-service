#!/usr/bin/env npx tsx
/**
 * Unified Local Source Scraper — Playwright-based, respectful rate limiting.
 *
 * Scrapes local recommendation sites and saves content as markdown + JSON
 * for NotebookLM text sources in the research pipeline.
 *
 * Supported sources:
 *   - the-infatuation      (theinfatuation.com)
 *   - timeout              (timeout.com)
 *   - locationscout        (locationscout.net)
 *
 * Usage:
 *   npx tsx src/scrapers/local-sources.ts --source the-infatuation --city tokyo
 *   npx tsx src/scrapers/local-sources.ts --source timeout --city tokyo
 *   npx tsx src/scrapers/local-sources.ts --source locationscout --interval 60
 *   npx tsx src/scrapers/local-sources.ts --source the-infatuation --dry-run
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VALID_SOURCES = [
  "the-infatuation",
  "timeout",
  "locationscout",
] as const;

type SourceName = (typeof VALID_SOURCES)[number];

interface City {
  id: string;
  name: string;
  country: string;
  clinicalName?: string;
  lat?: number;
  lng?: number;
  maxRadiusKm?: number;
}

interface ScrapedPlace {
  name: string;
  description: string;
  category: string;
  neighborhood?: string;
  photoInfo?: string;
  url?: string;
}

interface ScrapeResult {
  places: ScrapedPlace[];
  fullText: string;
}

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

// File is at src/scrapers/local-sources.ts; repo root is two levels up.
const PROJECT_ROOT = path.join(__dirname, "..", "..");
const CITY_CACHE = path.join(PROJECT_ROOT, "configs", "global_city_cache.json");
const DATA_ROOT = path.join(PROJECT_ROOT, "data");
const DEFAULT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCities(): City[] {
  return JSON.parse(fs.readFileSync(CITY_CACHE, "utf-8"));
}

function outputDir(source: SourceName): string {
  return path.join(DATA_ROOT, source);
}

function getCitiesNeedingScrape(cities: City[], source: SourceName): City[] {
  const dir = outputDir(source);
  if (!fs.existsSync(dir)) return cities;
  const existing = new Set(
    fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
  );
  return cities.filter((c) => !existing.has(c.id));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Dismiss common cookie/consent banners. Non-fatal if none found.
 */
async function dismissBanners(page: Page): Promise<void> {
  try {
    const selectors = [
      'button:has-text("Accept")',
      'button:has-text("I Accept")',
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("Got it")',
      'button:has-text("Allow")',
      'button:has-text("Allow all")',
      'button:has-text("Agree")',
      'button:has-text("OK")',
      'button:has-text("Continue")',
      '[class*="consent"] button',
      '[class*="cookie"] button',
      '[id*="consent"] button',
      '[id*="cookie"] button',
      '[data-testid="close-button"]',
    ];
    for (const sel of selectors) {
      const btn = page.locator(sel);
      if ((await btn.count()) > 0) {
        await btn.first().click({ timeout: 3000 });
        await page.waitForTimeout(500);
        break;
      }
    }
  } catch {
    /* no banner, fine */
  }
}

/**
 * Scroll the page to trigger lazy loading.
 */
async function scrollToLoad(page: Page, scrolls = 5): Promise<void> {
  for (let i = 0; i < scrolls; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
  }
}

/**
 * Extract full page body text, stripping cookie/consent overlays.
 */
async function extractBodyText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const noise = document.querySelectorAll(
      'nav, header, footer, [class*="nav"], [class*="menu"], [class*="subscribe"], [class*="newsletter"], [class*="popup"], [class*="modal"], [class*="consent"], [class*="cookie"], [id*="consent"], [id*="cookie"]'
    );
    noise.forEach((el) => el.remove());
    return document.body.innerText;
  });
}

/**
 * Check that the page body mentions the city name.
 */
function textMentionsCity(text: string, cityName: string): boolean {
  return text.toUpperCase().includes(cityName.toUpperCase());
}

/**
 * Try loading a list of candidate URLs. Returns the first one whose page
 * body mentions the city name and has substantial content.
 */
async function tryUrls(
  page: Page,
  urls: string[],
  cityName: string
): Promise<{ url: string; text: string } | null> {
  for (const url of urls) {
    console.log(`  → Trying: ${url}`);
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (!resp || resp.status() >= 400) continue;

      const title = await page.title();
      if (title.includes("Page Not Found") || title.includes("404") || title.includes("Access Denied")) {
        continue;
      }

      await dismissBanners(page);
      await scrollToLoad(page);

      const text = await extractBodyText(page);
      if (text.length < 500) continue;

      if (!textMentionsCity(text, cityName)) {
        console.log(`  ⚠ Page doesn't mention ${cityName}, trying next URL`);
        continue;
      }

      console.log(`  ✓ Loaded ${url} (${text.length} chars)`);
      return { url, text };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Source-specific scrapers
// ---------------------------------------------------------------------------

/**
 * Convert (lat, lng, radiusKm) to a NE/SW bounding box, formatted for The
 * Infatuation's finder endpoint as `north_lat,east_lng,south_lat,west_lng`.
 *
 * Reference URL pattern (from the live site):
 *   /finder?query=...&geoBounds=45.650465%2C-64.939951%2C29.780292%2C-117.842916
 */
function geoBoundsFor(city: City): string | null {
  if (city.lat === undefined || city.lng === undefined) return null;
  const radiusKm = city.maxRadiusKm ?? 25;
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((city.lat * Math.PI) / 180));
  const north = (city.lat + latDelta).toFixed(6);
  const south = (city.lat - latDelta).toFixed(6);
  const east = (city.lng + lngDelta).toFixed(6);
  const west = (city.lng - lngDelta).toFixed(6);
  return `${north},${east},${south},${west}`;
}

/**
 * The Infatuation — finder endpoint with per-city geoBounds, concatenated
 * with the legacy /{slug} city page when available.
 *
 * The two URLs surface different content: the finder returns the full
 * cross-city catalog (guides + reviews) scoped to a bounding box, while the
 * /{slug} city page surfaces individual venue reviews ("LATEST … REVIEWS")
 * not exposed by the finder's default rendering. Combining both gives the
 * richest grounding for Phase A.
 *
 * Phase A reads .md only; we skip structured place extraction here because
 * the finder's result-tile selectors are unverified and the prose body is
 * sufficient for grounding Phase B.
 */
async function scrapeTheInfatuation(page: Page, city: City): Promise<ScrapeResult> {
  const slug = slugify(city.name);
  const bounds = geoBoundsFor(city);

  const sections: string[] = [];

  // 1. Finder — broad catalog, geo-scoped
  if (bounds) {
    const query = encodeURIComponent(city.name.toLowerCase());
    const geo = encodeURIComponent(bounds);
    const finderUrl = `https://www.theinfatuation.com/finder?query=${query}&postType=POST_TYPE_UNSPECIFIED&geoBounds=${geo}&location=Infatuation`;
    const finderResult = await tryUrls(page, [finderUrl], city.name);
    if (finderResult) sections.push(`## Finder results (geo-scoped)\n\n${finderResult.text}`);
  }

  // 2. Legacy city page — individual venue reviews
  const slugResult = await tryUrls(
    page,
    [`https://www.theinfatuation.com/${slug}`, `https://www.theinfatuation.com/${slug}/guides`],
    city.name,
  );
  if (slugResult) sections.push(`## City page (venue reviews)\n\n${slugResult.text}`);

  if (sections.length === 0) return { places: [], fullText: "" };
  return { places: [], fullText: sections.join("\n\n") };
}

/**
 * TimeOut — general city guide.
 * URL: https://www.timeout.com/{slug}
 */
async function scrapeTimeOut(page: Page, city: City): Promise<ScrapeResult> {
  const slug = slugify(city.name);

  // TimeOut is a prose-only source — landing pages are round-up articles,
  // not individual venue cards. Live inspection 2026-04-08 confirmed zero
  // individual venue pages on /{slug}/things-to-do or /{slug}/restaurants.
  // Save MD fullText only; structured extraction would produce article titles.
  const urls = [
    `https://www.timeout.com/${slug}/things-to-do`,
    `https://www.timeout.com/${slug}/restaurants`,
  ];

  const result = await tryUrls(page, urls, city.name);
  if (!result) return { places: [], fullText: "" };

  return { places: [], fullText: result.text };
}

/**
 * Locationscout — photography-focused location guide.
 * URL: https://www.locationscout.net/{country_slug}/{slug}
 */
async function scrapeLocationscout(page: Page, city: City): Promise<ScrapeResult> {
  const slug = slugify(city.name);
  const countrySlug = slugify(city.country);

  // No /search?q= fallback — it returns global fuzzy matches (e.g. "Austin"
  // matches "Austria", "Westin Warsaw", "Curtin Springs Station"). If direct
  // city URL doesn't exist, return empty.
  const urls = [
    `https://www.locationscout.net/${countrySlug}/${slug}`,
    `https://www.locationscout.net/${countrySlug}/${slug}-${countrySlug}`,
    `https://www.locationscout.net/${slug}`,
  ];

  const result = await tryUrls(page, urls, city.name);
  if (!result) return { places: [], fullText: "" };

  const places = await page.evaluate(() => {
    const items: { name: string; description: string; category: string; photoInfo: string }[] = [];

    // Locationscout uses location cards with photo metadata
    const cards = document.querySelectorAll(
      '[class*="location"], [class*="spot"], [class*="card"], article, [class*="result"], [class*="item"]'
    );

    for (const card of cards) {
      const heading = card.querySelector("h2, h3, h4, [class*='title'], [class*='name']");
      const desc = card.querySelector("p, [class*='description'], [class*='summary']");
      const photoMeta = card.querySelector("[class*='photo'], [class*='camera'], [class*='time'], [class*='direction']");

      if (heading?.textContent?.trim() && heading.textContent.trim().length > 3) {
        const name = heading.textContent.trim();
        if (name.length > 120) continue;

        items.push({
          name: name.slice(0, 200),
          description: (desc?.textContent?.trim() || "").slice(0, 500),
          category: "photo-spot",
          photoInfo: (photoMeta?.textContent?.trim() || "").slice(0, 300),
        });
      }
    }

    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  return { places, fullText: result.text };
}

// ---------------------------------------------------------------------------
// Quality gate
// ---------------------------------------------------------------------------

/**
 * Reject structured places that look like round-up articles.
 * If > 75% of names match article patterns ("best X", "things to do", etc),
 * clear the places array. The .md text is kept either way.
 */
function applyQualityGate(places: ScrapedPlace[]): ScrapedPlace[] {
  if (places.length < 5) return places;

  const articleRegex = /\b(best|things to do|guide to|where to|top \d+|ultimate|coolest|greatest)\b/i;
  let articleCount = 0;
  for (const p of places) {
    if (articleRegex.test(p.name)) articleCount++;
  }

  const ratio = articleCount / places.length;
  if (ratio > 0.75) {
    console.log(`  ⚠ Quality gate: ${articleCount}/${places.length} article-like names (${Math.round(ratio * 100)}%) — discarding structured places`);
    return [];
  }
  return places;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function getScrapeFn(source: SourceName): (page: Page, city: City) => Promise<ScrapeResult> {
  switch (source) {
    case "the-infatuation":
      return scrapeTheInfatuation;
    case "timeout":
      return scrapeTimeOut;
    case "locationscout":
      return scrapeLocationscout;
  }
}

function getSourceLabel(source: SourceName): string {
  switch (source) {
    case "the-infatuation":
      return "The Infatuation";
    case "timeout":
      return "TimeOut";
    case "locationscout":
      return "Locationscout";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  // Parse --source
  const sourceIdx = args.indexOf("--source");
  if (sourceIdx === -1 || !args[sourceIdx + 1]) {
    console.error("ERROR: --source is required. Options: " + VALID_SOURCES.join(", "));
    process.exit(1);
  }
  const source = args[sourceIdx + 1] as SourceName;
  if (!VALID_SOURCES.includes(source)) {
    console.error(`ERROR: Invalid source "${source}". Options: ${VALID_SOURCES.join(", ")}`);
    process.exit(1);
  }

  // Parse other flags
  const cityFilter = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;
  const interval = args.includes("--interval")
    ? parseInt(args[args.indexOf("--interval") + 1]) * 1000
    : DEFAULT_INTERVAL_MS;
  const dryRun = args.includes("--dry-run");

  const label = getSourceLabel(source);
  const dir = outputDir(source);
  const scrapeFn = getScrapeFn(source);

  let cities = loadCities();

  if (cityFilter) {
    cities = cities.filter((c) => c.id === cityFilter);
    if (cities.length === 0) {
      console.error(`City "${cityFilter}" not found in global_city_cache.json`);
      process.exit(1);
    }
  } else {
    cities = getCitiesNeedingScrape(cities, source);
  }

  console.log(`${label} Scraper`);
  console.log(`Cities to scrape: ${cities.length}`);
  console.log(`Interval: ${interval / 1000}s between cities`);
  console.log(`Output: ${dir}`);
  console.log();

  if (dryRun) {
    cities.forEach((c, i) =>
      console.log(`  ${i + 1}. ${c.id} — ${c.name}, ${c.country}`)
    );
    return;
  }

  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    console.log(`\n[${i + 1}/${cities.length}] ${city.name}, ${city.country}`);

    // Fresh context per city to avoid cookie/session pollution
    const context: BrowserContext = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    let rawResult: ScrapeResult = { places: [], fullText: "" };
    let errored = false;
    try {
      rawResult = await scrapeFn(page, city);
    } catch (e) {
      console.log(`  ✗ Error: ${e}`);
      errored = true;
    }

    // Apply quality gate (clears places if mostly article titles)
    const gatedPlaces = applyQualityGate(rawResult.places);
    const hasContent = gatedPlaces.length > 0 || rawResult.fullText.length >= 500;

    // Always save stub JSON to prevent retry loops. The MD is only saved
    // when there's real fullText. Pipeline reads .md, not .json.
    const outPath = path.join(dir, `${city.id}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      city_id: city.id,
      city_name: city.name,
      country: city.country,
      scraped_at: new Date().toISOString(),
      source,
      places: gatedPlaces,
    }, null, 2));

    if (rawResult.fullText.length >= 500) {
      const mdPath = path.join(dir, `${city.id}.md`);
      fs.writeFileSync(mdPath, `# ${label}: ${city.name}, ${city.country}\n\n${rawResult.fullText}`);
    }

    if (errored || !hasContent) {
      console.log(`  ✗ ${city.name}: no usable content (stub saved)`);
      failed++;
    } else {
      console.log(`  ✓ ${city.name}: ${gatedPlaces.length} places, ${rawResult.fullText.length} chars MD`);
      completed++;
    }

    await context.close();

    // Rate limit between cities
    if (i < cities.length - 1) {
      console.log(`  ⏳ Waiting ${interval / 1000}s...`);
      await sleep(interval);
    }
  }

  await browser.close();

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Done: ${completed} scraped, ${failed} failed`);
  console.log(`${"=".repeat(40)}`);
}

main().catch(console.error);
