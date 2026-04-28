#!/usr/bin/env npx tsx
/**
 * Reddit Scraper — unauthenticated public JSON endpoints.
 *
 * Searches per-city subreddits for top-voted "things to do / hidden gems /
 * recommendations" posts and pulls the thread's top comments. Output feeds
 * src/pipeline/research_city.py Phase A as grounding for the 50 US town/village-tier
 * cities that editorial travel sources don't cover.
 *
 * Usage:
 *   npx tsx src/scrapers/reddit.ts                    # all cities missing .md
 *   npx tsx src/scrapers/reddit.ts --city akron       # single city
 *   npx tsx src/scrapers/reddit.ts --cities a,b,c     # comma list
 *   npx tsx src/scrapers/reddit.ts --interval 2500    # ms between API calls (default 2000)
 *   npx tsx src/scrapers/reddit.ts --dry-run          # preview only
 */

import * as fs from "fs";
import * as path from "path";

// File is at src/scrapers/reddit.ts; repo root is two levels up. Output
// data/ is at repo root (not src/data/); city cache moved to configs/.
const OUTPUT_DIR = path.join(__dirname, "..", "..", "data", "reddit");
const CITY_CACHE = path.join(__dirname, "..", "..", "configs", "global_city_cache.json");
const DEFAULT_INTERVAL_MS = 2000;
const USER_AGENT = "city-atlas-service/0.1 (+https://github.com/Anguijm/city-atlas-service; ops@anguijm.dev)";

// Tiered markdown floor matching wikipedia.ts — same floors, same rationale.
export function minMarkdownLength(coverageTier?: string): number {
  if (coverageTier === "village") return 250; // > 200-char Phase A gate
  if (coverageTier === "town") return 300;
  return 500; // metro + unknown
}

// Gate threshold: when the city name only appears in selftext (not title),
// require at least one comment with score >= this value to count as a real
// discussion rather than a passing mention.
// Metro/town: score >= 5 (established discussion).
// Village: score >= 1 (any net-positive engagement) — small communities rarely
// generate metro-level comment scores even on substantive local threads.
const MIN_CORROBORATING_COMMENT_SCORE = 5;
const MIN_CORROBORATING_COMMENT_SCORE_VILLAGE = 1;

// Reddit's search endpoint returns {t=year} well for our use-case; we pull
// top-sorted posts and discard stickies / NSFW / deleted.
const SEARCH_QUERIES = [
  "hidden gems",
  "must visit",
  "things to do",
  "favorite spots",
  "local recommendations",
  "best of",
];

const MAX_POSTS_PER_SUBREDDIT = 5;
const MAX_COMMENTS_PER_POST = 5;
const MIN_COMMENT_SCORE = 5;
const MAX_MARKDOWN_BYTES = 15_000;

export type RedditCity = {
  id: string;
  name: string;
  country: string;
  region?: string;
  coverageTier?: string;
};

export type RedditComment = {
  author: string;
  body: string;
  score: number;
};

export type RedditPost = {
  title: string;
  selftext: string;
  subreddit: string;
  author: string;
  score: number;
  url: string;
  permalink: string;
  id: string;
  comments: RedditComment[];
};

export type RetryOptions = { maxAttempts?: number; baseMs?: number; maxMs?: number };

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests (src/__tests__/scrape-reddit.test.ts)
// ---------------------------------------------------------------------------

export function buildSubredditCandidates(city: RedditCity): string[] {
  const lower = city.id.toLowerCase();
  const concat = lower.replace(/-/g, "");
  const underscored = lower.replace(/-/g, "_");
  const camelCase = city.id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  const candidates = [lower, concat, underscored, camelCase];
  if (city.region) candidates.push(city.region.toLowerCase().replace(/-/g, ""));
  candidates.push("travel"); // last-resort fallback
  return Array.from(new Set(candidates));
}

type SearchChild = { kind?: string; data?: Record<string, unknown> };

export function extractPostsFromSearchJson(json: unknown): RedditPost[] {
  const children =
    (json as { data?: { children?: SearchChild[] } })?.data?.children;
  if (!Array.isArray(children)) return [];
  const posts: RedditPost[] = [];
  for (const c of children) {
    if (c?.kind !== "t3" || !c.data) continue;
    const d = c.data as Record<string, unknown>;
    if (d.stickied === true) continue;
    if (d.over_18 === true) continue;
    const selftext = typeof d.selftext === "string" ? d.selftext : "";
    if (selftext === "[removed]" || selftext === "[deleted]") continue;
    const author = typeof d.author === "string" ? d.author : "";
    if (author === "[deleted]") continue;
    const title = typeof d.title === "string" ? d.title : "";
    if (!title) continue;
    posts.push({
      title,
      selftext,
      subreddit: typeof d.subreddit === "string" ? d.subreddit : "",
      author,
      score: typeof d.score === "number" ? d.score : 0,
      url: typeof d.url === "string" ? d.url : "",
      permalink: typeof d.permalink === "string" ? d.permalink : "",
      id: typeof d.id === "string" ? d.id : "",
      comments: [],
    });
  }
  return posts;
}

type ThreadChild = { kind?: string; data?: Record<string, unknown> };

export function extractCommentsFromThreadJson(
  json: unknown,
  minScore = MIN_COMMENT_SCORE,
): RedditComment[] {
  if (!Array.isArray(json) || json.length < 2) return [];
  const children = (json[1] as { data?: { children?: ThreadChild[] } })?.data?.children;
  if (!Array.isArray(children)) return [];
  const out: RedditComment[] = [];
  for (const c of children) {
    if (c?.kind !== "t1" || !c.data) continue;
    const d = c.data as Record<string, unknown>;
    const author = typeof d.author === "string" ? d.author : "";
    const body = typeof d.body === "string" ? d.body : "";
    const score = typeof d.score === "number" ? d.score : 0;
    if (author === "[deleted]" || body === "[deleted]" || body === "[removed]") continue;
    if (!author || !body) continue;
    if (score < minScore) continue;
    out.push({ author, body, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

type GatePost = {
  title: string;
  selftext: string;
  comments: Array<{ body?: string; score?: number }>;
};

export function passesQualityGate(
  posts: GatePost[],
  cityName: string,
  coverageTier?: string,
): boolean {
  if (!Array.isArray(posts) || !posts.length) return false;
  const needle = cityName.toLowerCase();
  const isVillage = coverageTier === "village";
  return posts.some((p) => {
    const title = (p.title ?? "").toLowerCase();
    const selftext = (p.selftext ?? "").toLowerCase();
    if (title.includes(needle)) return true;
    if (!selftext.includes(needle)) return false;
    const minScore = isVillage
      ? MIN_CORROBORATING_COMMENT_SCORE_VILLAGE
      : MIN_CORROBORATING_COMMENT_SCORE;
    const hasUpvotedComment = (p.comments ?? []).some(
      (c) => typeof c.score === "number" && c.score >= minScore,
    );
    return hasUpvotedComment;
  });
}

export function buildMarkdown(
  city: RedditCity,
  subreddit: string,
  posts: RedditPost[],
): string {
  const header =
    `# Reddit: ${city.name}, ${city.country}\n\n` +
    `Sources: /r/${subreddit}\n`;
  if (!posts.length) return header;
  const sections = posts.map((p) => {
    const commentLines = p.comments
      .map((c) => `- u/${c.author} (${c.score}): ${c.body.trim()}`)
      .join("\n");
    return (
      `## ${p.title}\n\n` +
      (p.selftext ? `${p.selftext.trim()}\n\n` : "") +
      (commentLines ? `### Top comments\n\n${commentLines}\n` : "")
    );
  });
  const out = `${header}\n${sections.join("\n")}`;
  // Cap payload.
  return out.length > MAX_MARKDOWN_BYTES ? out.slice(0, MAX_MARKDOWN_BYTES) : out;
}

export function buildStubJson(
  city: Pick<RedditCity, "id">,
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
// Network helpers
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (res.status === 429 || res.status >= 500) {
    throw new Error(`Retryable HTTP ${res.status} from ${url}`);
  }
  if (res.status === 403 || res.status === 404) {
    // Subreddit may not exist; treat as empty, non-retryable.
    return { data: { children: [] } };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

async function searchSubreddit(
  subreddit: string,
  query: string,
): Promise<RedditPost[]> {
  const url =
    `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?` +
    `q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=year&limit=25`;
  try {
    const json = await retryWithBackoff(() => fetchJson(url));
    return extractPostsFromSearchJson(json);
  } catch {
    return [];
  }
}

async function fetchThreadComments(
  permalink: string,
  interval: number,
): Promise<RedditComment[]> {
  if (!permalink) return [];
  const url = `https://www.reddit.com${permalink}.json?limit=20&sort=top`;
  try {
    const json = await retryWithBackoff(() => fetchJson(url));
    await sleep(interval); // space out thread hits
    return extractCommentsFromThreadJson(json).slice(0, MAX_COMMENTS_PER_POST);
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// City loader + main
// ---------------------------------------------------------------------------

type CachedCity = RedditCity & { [key: string]: unknown };

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
  subreddit: string | null;
  posts: number;
  mdChars: number;
  ok: boolean;
  reason?: string;
};

async function scrapeCity(city: CachedCity, interval: number): Promise<ScrapeOutcome> {
  const candidates = buildSubredditCandidates(city);
  for (const sub of candidates) {
    const seen = new Map<string, RedditPost>();
    for (const q of SEARCH_QUERIES) {
      const posts = await searchSubreddit(sub, q);
      await sleep(interval);
      for (const p of posts) {
        if (!seen.has(p.id)) seen.set(p.id, p);
        if (seen.size >= MAX_POSTS_PER_SUBREDDIT * 3) break;
      }
      if (seen.size >= MAX_POSTS_PER_SUBREDDIT * 3) break;
    }
    const top = Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_POSTS_PER_SUBREDDIT);
    for (const p of top) {
      p.comments = await fetchThreadComments(p.permalink, interval);
    }
    if (!passesQualityGate(top, city.name, city.coverageTier)) continue;
    const md = buildMarkdown(city, sub, top);
    if (md.length < minMarkdownLength(city.coverageTier)) continue;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, `${city.id}.md`), md);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${city.id}.json`),
      JSON.stringify(buildStubJson(city, "reddit", top.length), null, 2),
    );
    return { id: city.id, subreddit: sub, posts: top.length, mdChars: md.length, ok: true };
  }
  return {
    id: city.id,
    subreddit: null,
    posts: 0,
    mdChars: 0,
    ok: false,
    reason: "no subreddit candidate produced quality-gated posts",
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

  console.log(`Reddit Scraper`);
  console.log(`Cities to scrape: ${cities.length}`);
  console.log(`Interval: ${interval}ms between API calls`);

  if (dryRun) {
    cities.forEach((c, i) => console.log(`  ${i + 1}. ${c.id} — ${c.name}, ${c.country}`));
    return;
  }

  const report: ScrapeOutcome[] = [];
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];
    console.log(`\n[${i + 1}/${cities.length}] ${c.id} — ${c.name}, ${c.country}`);
    try {
      const outcome = await scrapeCity(c, interval);
      report.push(outcome);
      if (outcome.ok) {
        console.log(`  ✓ /r/${outcome.subreddit}: ${outcome.posts} posts, ${outcome.mdChars} chars`);
      } else {
        console.log(`  ✗ ${outcome.reason}`);
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
      report.push({ id: c.id, subreddit: null, posts: 0, mdChars: 0, ok: false, reason: String(err) });
    }
  }

  // Audit Task 5: emit a summary report.
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const logPath = path.join(OUTPUT_DIR, "_summary.log");
  const ok = report.filter((r) => r.ok);
  const fail = report.filter((r) => !r.ok);
  const summary =
    `Reddit scrape summary — ${new Date().toISOString()}\n` +
    `Scraped: ${ok.length}/${report.length}\n\n` +
    `UNBLOCKED (${ok.length}):\n` +
    ok.map((r) => `  ✓ ${r.id}  /r/${r.subreddit}  ${r.posts} posts, ${r.mdChars} chars`).join("\n") +
    `\n\nSTILL BLOCKED (${fail.length}):\n` +
    fail.map((r) => `  ✗ ${r.id}  ${r.reason ?? ""}`).join("\n") + "\n";
  fs.writeFileSync(logPath, summary);
  console.log(`\n${"=".repeat(60)}\nSummary: ${ok.length} scraped, ${fail.length} blocked\nLog: ${logPath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
