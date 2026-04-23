#!/usr/bin/env npx tsx
/**
 * Wikipedia Scraper — MediaWiki REST + opensearch fallback.
 *
 * Generates per-city markdown from Wikipedia articles, restricted to POI-rich
 * sections (Culture / Tourism / Neighborhoods / Landmarks / etc.). Output feeds
 * src/pipeline/research_city.py Phase A as grounding for the 50 US town/village-tier
 * cities that editorial travel sources don't cover.
 *
 * Usage:
 *   npx tsx src/scrapers/wikipedia.ts                    # all cities missing .md
 *   npx tsx src/scrapers/wikipedia.ts --city akron       # single city
 *   npx tsx src/scrapers/wikipedia.ts --cities a,b,c     # comma list
 *   npx tsx src/scrapers/wikipedia.ts --interval 2000    # ms between cities (default 1500)
 *   npx tsx src/scrapers/wikipedia.ts --dry-run          # preview only
 */

import * as fs from "fs";
import * as path from "path";

const OUTPUT_DIR = path.join(__dirname, "..", "data", "wikipedia");
const CITY_CACHE = path.join(__dirname, "..", "src", "data", "global_city_cache.json");
const DEFAULT_INTERVAL_MS = 1500;
const USER_AGENT = "UrbanExplorer/1.0 (+https://urbanexplorer.app; anguijm@gmail.com)";

// Shared floor for per-city .md output. Higher than Phase A's 200-char gate
// (src/pipeline/research_city.py:350) so we never produce output Phase A rejects.
export const MIN_MARKDOWN_LENGTH = 500;

// Per-section minimum prose size — discards stub subsections.
const MIN_SECTION_CHARS = 80;

// Sections we keep (lowercased match — substring allowed so "Parks and recreation"
// matches on "parks"). Matches the allowlist we documented in the plan audit.
const SECTION_ALLOWLIST = [
  "culture",
  "tourism",
  "attractions",
  "landmarks",
  "neighborhoods",
  "districts",
  "arts",
  "architecture",
  "music",
  "food",
  "cuisine",
  "parks",
  "recreation",
  "nightlife",
  "points of interest",
  "notable",       // "Notable places", "Notable residences" — POI-dense on town articles
  "historic",      // "Historic district" sections list named buildings/streets
  "sports",        // stadiums, venues
  "entertainment",
];

export type WikiCity = {
  id: string;
  name: string;
  country: string;
  clinicalName?: string;
  region?: string;
};

// City ids like `portland-me`, `jackson-wy`, `rochester-ny` encode the US
// state as a two-letter suffix. We use the suffix to disambiguate Wikipedia
// articles (Portland, Oregon vs Portland, Maine). Populated from the 50 new
// US cities in commit 6dee276; extend as needed.
const US_STATE_CODES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California",
  co: "Colorado", ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia",
  hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
  ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland",
  ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi",
  mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire",
  nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina",
  nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania",
  ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee",
  tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington",
  wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};

export function stateFromId(id: string): string | null {
  const m = id.match(/-([a-z]{2})$/);
  return m ? US_STATE_CODES[m[1]] ?? null : null;
}

export type WikiSection = { title: string; plaintext: string };

export type RetryOptions = { maxAttempts?: number; baseMs?: number; maxMs?: number };

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests (src/__tests__/scrape-wikipedia.test.ts)
// ---------------------------------------------------------------------------

export function buildTitleCandidates(city: WikiCity): string[] {
  const candidates: string[] = [];
  // 1. A state hint derived from the id suffix (`portland-me` → "Portland, Maine")
  //    is the strongest disambiguator for US cities. Beats clinicalName because
  //    clinicalName in our cache is often bare ("Akron", "Portland") and the
  //    suffix is always the canonical 2-letter code we set at tiering time.
  const stateHint = stateFromId(city.id);
  if (stateHint) candidates.push(`${city.name}, ${stateHint}`);
  // 2. clinicalName if it's already disambiguated (contains a comma).
  if (
    city.clinicalName &&
    city.clinicalName.includes(",") &&
    city.clinicalName !== city.name
  ) {
    candidates.push(city.clinicalName);
  }
  // 3. Country-qualified form — works for most international cities.
  if (city.country) candidates.push(`${city.name}, ${city.country}`);
  // 4. Bare name — last-ditch fallback.
  candidates.push(city.name);
  return Array.from(new Set(candidates));
}

export function selectRelevantSections(sections: WikiSection[]): WikiSection[] {
  if (!Array.isArray(sections)) return [];
  return sections.filter((s) => {
    if (!s || typeof s.title !== "string" || typeof s.plaintext !== "string") return false;
    if (s.plaintext.length < MIN_SECTION_CHARS) return false;
    const title = s.title.toLowerCase();
    return SECTION_ALLOWLIST.some((kw) => title.includes(kw));
  });
}

export function buildMarkdown(city: WikiCity, sections: WikiSection[]): string {
  const header = `# Wikipedia: ${city.name}, ${city.country}\n`;
  if (!sections.length) return header;
  const body = sections
    .map((s) => `## ${s.title}\n\n${s.plaintext.trim()}`)
    .join("\n\n");
  return `${header}\n${body}\n`;
}

export function buildStubJson(
  city: Pick<WikiCity, "id">,
  source: string,
  placeCount: number,
): Record<string, unknown> {
  return {
    source,
    cityId: city.id,
    retrievedAt: new Date().toISOString(),
    placeCount,
  };
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 15_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * Math.min(250, delay / 4));
      await sleep(delay + jitter);
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Network helpers — not directly unit-tested (exercised by integration runs)
// ---------------------------------------------------------------------------

type ParseApiResponse = {
  parse?: {
    title?: string;
    text?: { "*"?: string };
    sections?: Array<{ line?: string; level?: string; toclevel?: number }>;
  };
  error?: { code?: string; info?: string };
};

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (res.status === 429 || res.status >= 500) {
    throw new Error(`Retryable HTTP ${res.status} from ${url}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

async function fetchParse(title: string): Promise<ParseApiResponse | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?` +
    `action=parse&format=json&redirects=1&prop=text|sections&` +
    `page=${encodeURIComponent(title)}`;
  try {
    const json = (await retryWithBackoff(() => fetchJson(url))) as ParseApiResponse;
    if (json?.error) return null;
    if (!json?.parse?.text?.["*"]) return null;
    return json;
  } catch {
    return null;
  }
}

async function openSearch(query: string, limit = 8): Promise<string[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?` +
    `action=opensearch&format=json&limit=${limit}&namespace=0&` +
    `search=${encodeURIComponent(query)}`;
  try {
    const json = (await retryWithBackoff(() => fetchJson(url))) as unknown[];
    // opensearch returns: [searchTerm, [titles], [descs], [urls]]
    const titles = Array.isArray(json?.[1]) ? (json[1] as string[]) : [];
    return titles;
  } catch {
    return [];
  }
}

/**
 * Parse MediaWiki's parsed HTML into sections. We handle both heading formats:
 *   - Current (2024+): <h2 id="History">History</h2>
 *   - Legacy:          <h2><span class="mw-headline" id="History">History</span></h2>
 * We split on h2+h3 so POI-rich subsections like "Neighborhoods" (h3 under
 * "Geography") aren't dropped.
 */
function extractSectionsFromHtml(html: string): WikiSection[] {
  if (typeof html !== "string" || !html.length) return [];
  // Tokenise on any h2 or h3 opening tag while keeping the tag text so we can
  // recover level + title. Use capturing groups + split on the match index.
  const headingRe = /<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/gi;
  type Hit = { level: number; title: string; start: number; end: number };
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html))) {
    const level = m[1].toLowerCase() === "h2" ? 2 : 3;
    // Inner text may be plain ("History") or wrapped in a headline span.
    const inner = m[3];
    const headlineMatch = inner.match(/<span[^>]*class="[^"]*mw-headline[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const titleText = headlineMatch ? headlineMatch[1] : inner;
    const title = stripTags(titleText).trim();
    if (!title) continue;
    hits.push({ level, title, start: m.index, end: m.index + m[0].length });
  }
  const sections: WikiSection[] = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].end;
    const stop = i + 1 < hits.length ? hits[i + 1].start : html.length;
    const plaintext = htmlToPlaintext(html.slice(start, stop));
    sections.push({ title: hits[i].title, plaintext });
  }
  return sections;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function htmlToPlaintext(html: string): string {
  // Remove scripts / styles / references / tables / infoboxes — keep prose.
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, "")
    .replace(/<ol class="references"[\s\S]*?<\/ol>/gi, "")
    .replace(/<sup[^>]*class="reference"[^>]*>[\s\S]*?<\/sup>/gi, "")
    // MediaWiki adds `[edit]` affordance spans on every heading.
    .replace(/<span[^>]*class="mw-editsection"[\s\S]*?<\/span>\s*<\/?span[^>]*>\s*<\/?span[^>]*>/gi, "")
    .replace(/<span[^>]*class="mw-editsection"[\s\S]*?<\/span>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  // Strip tags then decode entities (incl. numeric like &#91; = "[", &#93; = "]").
  s = stripTags(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    // Drop Wikipedia reference and citation-needed markers. We run these
    // after entity decoding so `&#91;edit&#93;` → `[edit]` → "" works.
    .replace(/\[\s*\d+\s*\]/g, "")
    .replace(/\[\s*citation needed\s*\]/gi, "")
    .replace(/\[\s*edit\s*\]/gi, "")
    // Strip leftover orphan markers (e.g. `edit]` on its own line) that appear
    // when a span wrapper was partially removed but the trailing bracket wasn't.
    .replace(/^\s*edit\]\s*$/gim, "")
    // Collapse whitespace.
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

async function resolveArticleHtml(city: WikiCity): Promise<{ title: string; html: string } | null> {
  const tried = new Set<string>();
  // tryTitle returns an article only if it looks like a real city article:
  // (a) parse succeeded, (b) not a disambiguation page, (c) the page is about
  // the city (has geographic signals) OR produces at least one POI-allowlist
  // section. Otherwise we fall through so the caller can keep searching.
  const tryTitle = async (title: string) => {
    const key = title.toLowerCase();
    if (tried.has(key)) return null;
    tried.add(key);
    const parsed = await fetchParse(title);
    const html = parsed?.parse?.text?.["*"];
    if (!html || isDisambiguation(html)) return null;
    const resolvedTitle = parsed?.parse?.title ?? title;
    if (!looksLikeCityArticle(html, city, resolvedTitle)) return null;
    return { title: resolvedTitle, html };
  };

  // Step 1: direct title candidates.
  for (const title of buildTitleCandidates(city)) {
    if (process.env.WIKI_TRACE) console.log(`  [trace] step1: try "${title}"`);
    const hit = await tryTitle(title);
    if (process.env.WIKI_TRACE) console.log(`  [trace] step1: "${title}" → ${hit ? "HIT " + hit.title : "miss"}`);
    if (hit) return hit;
  }

  // Step 2: opensearch with preference for disambiguated city-form results.
  // Many small US cities (Bend, Marfa, Kahului) share their name with other
  // articles, so opensearch's first hit is often the disambig page or an
  // unrelated topic. Filter for `{name}, ...` forms before trying anything else.
  const queries: string[] = [city.name];
  if (city.country) queries.push(`${city.name} ${city.country}`);
  const namePrefix = city.name.toLowerCase() + ", ";
  const ranked: string[] = [];
  for (const q of queries) {
    const results = await openSearch(q);
    // Rank disambiguated city-form first, then anything else from the list.
    const disambiguated = results.filter((r) => r.toLowerCase().startsWith(namePrefix));
    const others = results.filter((r) => !r.toLowerCase().startsWith(namePrefix));
    for (const r of [...disambiguated, ...others]) {
      if (!ranked.includes(r)) ranked.push(r);
    }
  }
  if (process.env.WIKI_TRACE) console.log(`  [trace] step2: ranked candidates = ${JSON.stringify(ranked)}`);
  for (const title of ranked) {
    if (process.env.WIKI_TRACE) console.log(`  [trace] step2: try "${title}"`);
    const hit = await tryTitle(title);
    if (process.env.WIKI_TRACE) console.log(`  [trace] step2: "${title}" → ${hit ? "HIT " + hit.title : "miss"}`);
    if (hit) return hit;
  }
  return null;
}

/**
 * A resolved article passes only if it actually describes a populated place.
 * Wikipedia stores that on every city/town article in standard infobox fields.
 * We also accept any article that lands in the "Category:...populated places"
 * / "...cities in..." / "...villages in..." category trees. This prevents us
 * from accepting unrelated articles that happen to share the city's name —
 * e.g., "Bend" returns a real non-disambig article about bending as a shape.
 */
function looksLikeCityArticle(html: string, city: WikiCity, resolvedTitle: string): boolean {
  // A disambiguated title like "Bend, Oregon" is already self-identifying.
  if (/^[A-Z][\w\s.'-]+,\s+[A-Z]/.test(resolvedTitle) && resolvedTitle !== city.name) {
    return true;
  }
  // Infobox settlement is the canonical city/town template.
  if (/infobox[_-]settlement|infobox[_-](city|town|village|municipality)/i.test(html)) return true;
  // Category fallback — MediaWiki appends categories at the bottom of parsed HTML.
  const cityCategoryRe =
    /Category:(Cities|Towns|Villages|Populated_places|Municipalities|Census-designated_places|Communities)[^"'<]*/i;
  if (cityCategoryRe.test(html)) return true;
  return false;
}

function isDisambiguation(html: string): boolean {
  // Look for the category link that ONLY real disambiguation pages carry. The
  // old `class="[^"]*disambig/` regex matched navigation helpers like
  // `mw-disambig-link` on regular articles (e.g., "Akron, Ohio"), causing
  // false positives. The Category link is the authoritative signal.
  if (/Category:(All_disambiguation_pages|Disambiguation_pages)/i.test(html)) return true;
  // As a weaker fallback, look for "may refer to:" in the opening paragraph.
  const lead = html.slice(0, 2000);
  if (/<p>[^<]*\bmay refer to:/i.test(lead)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// City loader + main
// ---------------------------------------------------------------------------

type CachedCity = WikiCity & { [key: string]: unknown };

function loadCities(): CachedCity[] {
  return JSON.parse(fs.readFileSync(CITY_CACHE, "utf-8"));
}

function citiesNeedingScrape(cities: CachedCity[]): CachedCity[] {
  if (!fs.existsSync(OUTPUT_DIR)) return cities;
  const existing = new Set(
    fs.readdirSync(OUTPUT_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", "")),
  );
  return cities.filter((c) => !existing.has(c.id));
}

type ScrapeOutcome = {
  id: string;
  resolvedTitle: string | null;
  sections: number;
  mdChars: number;
  ok: boolean;
  reason?: string;
};

async function scrapeCity(city: CachedCity): Promise<ScrapeOutcome> {
  const resolved = await resolveArticleHtml(city);
  if (!resolved) {
    return {
      id: city.id,
      resolvedTitle: null,
      sections: 0,
      mdChars: 0,
      ok: false,
      reason: "no article matched (parse + opensearch both failed)",
    };
  }
  const rawSections = extractSectionsFromHtml(resolved.html);
  const keep = selectRelevantSections(rawSections);
  const md = buildMarkdown(city, keep);
  if (md.length < MIN_MARKDOWN_LENGTH) {
    return {
      id: city.id,
      resolvedTitle: resolved.title,
      sections: keep.length,
      mdChars: md.length,
      ok: false,
      reason: `markdown too short (${md.length} < ${MIN_MARKDOWN_LENGTH})`,
    };
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const mdPath = path.join(OUTPUT_DIR, `${city.id}.md`);
  fs.writeFileSync(mdPath, md);
  const stubPath = path.join(OUTPUT_DIR, `${city.id}.json`);
  fs.writeFileSync(stubPath, JSON.stringify(buildStubJson(city, "wikipedia", keep.length), null, 2));
  return {
    id: city.id,
    resolvedTitle: resolved.title,
    sections: keep.length,
    mdChars: md.length,
    ok: true,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const idxCity = args.indexOf("--city");
  const idxCities = args.indexOf("--cities");
  const idxInterval = args.indexOf("--interval");
  const dryRun = args.includes("--dry-run");

  let cities = loadCities() as CachedCity[];

  if (idxCity >= 0) {
    const id = args[idxCity + 1];
    cities = cities.filter((c) => c.id === id);
  } else if (idxCities >= 0) {
    const ids = new Set((args[idxCities + 1] || "").split(",").map((s) => s.trim()).filter(Boolean));
    cities = cities.filter((c) => ids.has(c.id));
  } else {
    cities = citiesNeedingScrape(cities);
  }

  const interval = idxInterval >= 0 ? parseInt(args[idxInterval + 1], 10) : DEFAULT_INTERVAL_MS;

  if (!cities.length) {
    console.log("No cities to scrape (all already have .md output).");
    return;
  }

  console.log(`Wikipedia Scraper`);
  console.log(`Cities to scrape: ${cities.length}`);
  console.log(`Interval: ${interval}ms`);

  if (dryRun) {
    cities.forEach((c, i) => console.log(`  ${i + 1}. ${c.id} — ${c.name}, ${c.country}`));
    return;
  }

  const report: ScrapeOutcome[] = [];
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];
    console.log(`\n[${i + 1}/${cities.length}] ${c.id} — ${c.name}, ${c.country}`);
    try {
      const outcome = await scrapeCity(c);
      report.push(outcome);
      if (outcome.ok) {
        console.log(`  ✓ ${outcome.resolvedTitle} → ${outcome.sections} sections, ${outcome.mdChars} chars`);
      } else {
        console.log(`  ✗ ${outcome.reason}`);
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
      report.push({ id: c.id, resolvedTitle: null, sections: 0, mdChars: 0, ok: false, reason: String(err) });
    }
    if (i < cities.length - 1) await sleep(interval);
  }

  // Audit Task 5: emit a summary report.
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const logPath = path.join(OUTPUT_DIR, "_summary.log");
  const ok = report.filter((r) => r.ok);
  const fail = report.filter((r) => !r.ok);
  const summary =
    `Wikipedia scrape summary — ${new Date().toISOString()}\n` +
    `Scraped: ${ok.length}/${report.length}\n\n` +
    `UNBLOCKED (${ok.length}):\n` +
    ok.map((r) => `  ✓ ${r.id}  [${r.resolvedTitle}]  ${r.sections} sections, ${r.mdChars} chars`).join("\n") +
    `\n\nSTILL BLOCKED (${fail.length}):\n` +
    fail.map((r) => `  ✗ ${r.id}  ${r.reason ?? ""}`).join("\n") + "\n";
  fs.writeFileSync(logPath, summary);
  console.log(`\n${"=".repeat(60)}\nSummary: ${ok.length} scraped, ${fail.length} blocked\nLog: ${logPath}`);
}

// Only run CLI if invoked directly (not when imported by vitest).
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
