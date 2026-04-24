#!/usr/bin/env npx tsx
/**
 * Atlas Obscura Scraper — Playwright-based, respectful rate limiting.
 *
 * Pre-scrapes Atlas Obscura "things to do" pages for cities and saves
 * the content as markdown files that can be fed to NotebookLM as text sources.
 *
 * Usage:
 *   npx tsx src/scrapers/atlas-obscura.ts                    # all cities missing data
 *   npx tsx src/scrapers/atlas-obscura.ts --city venice      # single city
 *   npx tsx src/scrapers/atlas-obscura.ts --interval 3600    # 1 per hour (default: 30s)
 *   npx tsx src/scrapers/atlas-obscura.ts --dry-run          # preview only
 */

import { chromium, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

// File is at src/scrapers/atlas-obscura.ts; repo root is two levels up.
// Output data/ is at repo root (not src/data/); city cache moved to configs/.
const OUTPUT_DIR = path.join(__dirname, "..", "..", "data", "atlas-obscura");
const CITY_CACHE = path.join(__dirname, "..", "..", "configs", "global_city_cache.json");
const DEFAULT_INTERVAL_MS = 30_000; // 30s between requests

interface City {
  id: string;
  name: string;
  country: string;
  clinicalName?: string;
}

interface ScrapedPlace {
  name: string;
  description: string;
  location: string;
  tags: string[];
  url: string;
}

function loadCities(): City[] {
  return JSON.parse(fs.readFileSync(CITY_CACHE, "utf-8"));
}

function getCitiesNeedingScrape(cities: City[]): City[] {
  if (!fs.existsSync(OUTPUT_DIR)) return cities;
  const existing = new Set(
    fs.readdirSync(OUTPUT_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
  );
  return cities.filter((c) => !existing.has(c.id));
}

function buildAtlasUrl(city: City): string {
  // Atlas Obscura uses various URL patterns — try the most common
  const slug = city.name.toLowerCase().replace(/\s+/g, "-");
  return `https://www.atlasobscura.com/things-to-do/${slug}`;
}

async function scrapeCityPage(page: Page, city: City): Promise<{ places: ScrapedPlace[]; fullText: string }> {
  // Try multiple URL patterns — Atlas Obscura is inconsistent with slugs
  const slug = city.name.toLowerCase().replace(/\s+/g, "-");
  const countrySlug = city.country.toLowerCase().replace(/\s+/g, "-");
  // Some cities use alternate names (e.g., "new-york" not "new-york-city")
  const altSlug = slug
    .replace("-city", "")
    .replace("ho-chi-minh", "saigon")
    .replace("mexico-city", "mexico-city"); // keep as-is
  const urls = [
    `https://www.atlasobscura.com/things-to-do/${slug}-${countrySlug}`,
    `https://www.atlasobscura.com/things-to-do/${slug}`,
    ...(altSlug !== slug ? [`https://www.atlasobscura.com/things-to-do/${altSlug}`] : []),
    `https://www.atlasobscura.com/things-to-do/${slug}-${countrySlug.split("-")[0]}`,
  ];

  let loaded = false;
  let bestPlaces: { name: string; description: string; location: string; tags: string[]; url: string }[] = [];
  let bestFullText = "";

  for (const url of urls) {
    console.log(`  → Trying: ${url}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      const title = await page.title();
      if (title.includes("Page Not Found") || title.includes("Access Denied")) {
        continue;
      }

      // Dismiss cookie/consent banners
      try {
        const consentBtn = page.locator('button:has-text("Accept"), button:has-text("I Accept"), button:has-text("Got it"), button:has-text("Allow"), [class*="consent"] button, [class*="cookie"] button');
        if (await consentBtn.count() > 0) {
          await consentBtn.first().click({ timeout: 3000 });
          await page.waitForTimeout(500);
        }
      } catch { /* no banner, fine */ }

      // Scroll to load content
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }

      // Quick check: does the page mention the city name?
      const bodyText = await page.evaluate(() => {
        // Remove consent/cookie overlays from DOM before reading
        const noise = document.querySelectorAll('[class*="consent"], [class*="cookie"], [class*="modal"], [id*="consent"], [id*="cookie"]');
        noise.forEach(el => el.remove());
        return document.body.innerText;
      });
      const cityUpper = city.name.toUpperCase();
      if (!bodyText.toUpperCase().includes(cityUpper)) {
        console.log(`  ⚠ Page doesn't mention ${city.name}, trying next URL`);
        continue;
      }

      // Extract places from this URL
      const places = extractPlacesFromText(bodyText, city.name);
      if (places.length > bestPlaces.length) {
        bestPlaces = places;
        bestFullText = bodyText;
        loaded = true;
        console.log(`  ✓ Found ${places.length} places at ${url}`);
        if (places.length >= 5) break; // good enough, stop trying
      } else if (!loaded && bodyText.length > 1000) {
        // Page has content even if no structured places
        bestFullText = bodyText;
        loaded = true;
      }
    } catch {
      continue;
    }
  }

  if (!loaded) {
    console.log(`  ✗ Could not load Atlas Obscura page for ${city.name}`);
    return { places: [], fullText: "" };
  }

  console.log(`  ✓ ${bestPlaces.length} places (${bestFullText.length} chars total)`);
  return { places: bestPlaces, fullText: bestFullText };
}

function extractPlacesFromText(
  text: string,
  cityName: string
): ScrapedPlace[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const places: ScrapedPlace[] = [];
  const cityUpper = cityName.toUpperCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.toUpperCase().includes(cityUpper) &&
      line.includes(",") &&
      line === line.toUpperCase() &&
      line.length < 60
    ) {
      const name = lines[i + 1]?.trim();
      const desc = lines[i + 2]?.trim() || "";
      if (
        name &&
        !name.includes("Been Here") &&
        !name.includes("Want to Visit") &&
        !name.includes("Add to List") &&
        name.length > 3 &&
        name.length < 120
      ) {
        places.push({
          name,
          description: desc,
          location: line,
          tags: [],
          url: "",
        });
      }
    }
  }

  return places;
}

async function scrapeDetailPage(
  page: Page,
  placeUrl: string
): Promise<string> {
  if (!placeUrl.startsWith("http")) {
    placeUrl = `https://www.atlasobscura.com${placeUrl}`;
  }

  try {
    await page.goto(placeUrl, { waitUntil: "networkidle", timeout: 20_000 });

    const content = await page.evaluate(() => {
      const article = document.querySelector(
        '[class*="place-body"], [class*="article-body"], article, main'
      );
      return article?.textContent?.trim() || "";
    });

    return content.slice(0, 2000); // Cap at 2000 chars per place
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const cityFilter = args.includes("--city")
    ? args[args.indexOf("--city") + 1]
    : null;
  const interval = args.includes("--interval")
    ? parseInt(args[args.indexOf("--interval") + 1]) * 1000
    : DEFAULT_INTERVAL_MS;
  const dryRun = args.includes("--dry-run");
  const withDetails = args.includes("--details"); // scrape individual place pages too

  let cities = loadCities();

  if (cityFilter) {
    cities = cities.filter((c) => c.id === cityFilter);
    if (cities.length === 0) {
      console.error(`City "${cityFilter}" not found`);
      process.exit(1);
    }
  } else {
    cities = getCitiesNeedingScrape(cities);
  }

  console.log(`Atlas Obscura Scraper`);
  console.log(`Cities to scrape: ${cities.length}`);
  console.log(`Interval: ${interval / 1000}s between cities`);
  console.log(`Details: ${withDetails ? "yes" : "no (listing only)"}`);
  console.log();

  if (dryRun) {
    cities.forEach((c, i) =>
      console.log(`  ${i + 1}. ${c.id} — ${c.name}, ${c.country}`)
    );
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    console.log(`\n[${i + 1}/${cities.length}] ${city.name}, ${city.country}`);

    // Fresh context per city to avoid cookie/session pollution
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    try {
      const { places, fullText } = await scrapeCityPage(page, city);

      if (places.length === 0 && fullText.length < 500) {
        failed++;
        continue;
      }

      // Optionally scrape detail pages for richer content
      if (withDetails) {
        for (const place of places.slice(0, 20)) {
          if (place.url) {
            console.log(`    → Detail: ${place.name}`);
            const detail = await scrapeDetailPage(page, place.url);
            if (detail) {
              place.description = detail;
            }
            await sleep(2000); // 2s between detail pages
          }
        }
      }

      // Save full text as markdown (for NotebookLM text source)
      const mdPath = path.join(OUTPUT_DIR, `${city.id}.md`);
      fs.writeFileSync(
        mdPath,
        `# Atlas Obscura: ${city.name}, ${city.country}\n\n${fullText}`
      );

      // Save structured places as JSON
      const output = {
        city_id: city.id,
        city_name: city.name,
        country: city.country,
        scraped_at: new Date().toISOString(),
        source: "atlas-obscura",
        places,
      };

      const outPath = path.join(OUTPUT_DIR, `${city.id}.json`);
      fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
      console.log(`  ✓ Saved ${places.length} places → ${outPath}`);
      completed++;
    } catch (e) {
      console.log(`  ✗ Error: ${e}`);
      failed++;
    } finally {
      await context.close();
    }

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
