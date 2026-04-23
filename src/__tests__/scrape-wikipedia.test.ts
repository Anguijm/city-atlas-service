import { describe, it, expect } from "vitest";

type WikiCity = {
  id: string;
  name: string;
  country: string;
  clinicalName?: string;
  region?: string;
};

type WikiSection = { title: string; plaintext: string };

// Shared with scrape-reddit. Floor prevents trivial markdown (~500 chars covers
// a header + one section). Higher than the Phase A gate of 200 chars
// (src/pipeline/research_city.py:350) so we never produce output that Phase A rejects.
const MIN_MARKDOWN_LENGTH = 500;

describe("scrape-wikipedia logic", () => {
  describe("buildTitleCandidates", () => {
    it("starts with clinicalName when it is disambiguated (contains comma)", async () => {
      const { buildTitleCandidates } = await import("../scrapers/wikipedia");
      const city: WikiCity = {
        id: "asheville",
        name: "Asheville",
        clinicalName: "Asheville, North Carolina",
        country: "United States",
      };
      const candidates = buildTitleCandidates(city);
      expect(candidates[0]).toBe("Asheville, North Carolina");
    });

    it("falls back through country-qualified form when clinicalName is bare", async () => {
      const { buildTitleCandidates } = await import("../scrapers/wikipedia");
      const city: WikiCity = {
        id: "akron",
        name: "Akron",
        clinicalName: "Akron",
        country: "United States",
      };
      const candidates = buildTitleCandidates(city);
      expect(candidates).toContain("Akron");
      expect(candidates.some((c) => c.includes("United States"))).toBe(true);
      expect(candidates[candidates.length - 1]).toBe("Akron");
    });

    it("returns unique candidates in order (no dupes)", async () => {
      const { buildTitleCandidates } = await import("../scrapers/wikipedia");
      const city: WikiCity = { id: "paris", name: "Paris", clinicalName: "Paris", country: "France" };
      const candidates = buildTitleCandidates(city);
      expect(new Set(candidates).size).toBe(candidates.length);
    });

    it("handles missing clinicalName without crashing", async () => {
      const { buildTitleCandidates } = await import("../scrapers/wikipedia");
      const city: WikiCity = { id: "marfa", name: "Marfa", country: "United States" };
      const candidates = buildTitleCandidates(city);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates).toContain("Marfa");
    });

    it("uses id state suffix as the FIRST candidate for US cities (portland-me → Portland, Maine)", async () => {
      const { buildTitleCandidates } = await import("../scrapers/wikipedia");
      const city: WikiCity = {
        id: "portland-me",
        name: "Portland",
        clinicalName: "Portland",
        country: "United States",
      };
      const candidates = buildTitleCandidates(city);
      expect(candidates[0]).toBe("Portland, Maine");
    });

    it("prefers state suffix over country qualifier (jackson-wy → Jackson, Wyoming)", async () => {
      const { buildTitleCandidates } = await import("../scrapers/wikipedia");
      const city: WikiCity = {
        id: "jackson-wy",
        name: "Jackson",
        country: "United States",
      };
      const candidates = buildTitleCandidates(city);
      expect(candidates[0]).toBe("Jackson, Wyoming");
      expect(candidates).toContain("Jackson, United States");
    });

    it("ignores id suffix when it isn't a real US state code", async () => {
      const { stateFromId } = await import("../scrapers/wikipedia");
      expect(stateFromId("traverse-city")).toBeNull();
      expect(stateFromId("long-beach")).toBeNull();
      expect(stateFromId("jersey-city")).toBeNull();
      expect(stateFromId("jackson-wy")).toBe("Wyoming");
      expect(stateFromId("portland-me")).toBe("Maine");
    });
  });

  describe("selectRelevantSections", () => {
    // Each plaintext is padded above the per-section prose floor (~80 chars) so
    // this test exercises the allowlist path only. The length-filter case lives
    // in its own test below.
    const longProse = (seed: string) =>
      `${seed} — ` + "x".repeat(120);
    const fixture: WikiSection[] = [
      { title: "History", plaintext: longProse("Founded 1825") },
      { title: "Culture", plaintext: longProse("Murals and music festivals") },
      { title: "Economy", plaintext: longProse("Steel and finance") },
      { title: "Tourism", plaintext: longProse("The riverwalk and") },
      { title: "Demographics", plaintext: longProse("Population 190,000") },
      { title: "Neighborhoods", plaintext: longProse("Highland Square, Merriman Valley") },
      { title: "Parks and recreation", plaintext: longProse("Cuyahoga Valley") },
      { title: "Sister cities", plaintext: longProse("Chemnitz, Germany") },
    ];

    it("keeps POI-rich sections and drops boilerplate sections", async () => {
      const { selectRelevantSections } = await import("../scrapers/wikipedia");
      const kept = selectRelevantSections(fixture);
      const keptTitles = kept.map((s) => s.title);
      expect(keptTitles).toContain("Culture");
      expect(keptTitles).toContain("Tourism");
      expect(keptTitles).toContain("Neighborhoods");
      expect(keptTitles).toContain("Parks and recreation");
      expect(keptTitles).not.toContain("Demographics");
      expect(keptTitles).not.toContain("Economy");
      expect(keptTitles).not.toContain("Sister cities");
      expect(keptTitles).not.toContain("History");
    });

    it("matches allowlist case-insensitively and handles subsection prefixes", async () => {
      const { selectRelevantSections } = await import("../scrapers/wikipedia");
      const sections: WikiSection[] = [
        { title: "culture and arts", plaintext: longProse("local art scene") },
        { title: "Food and drink", plaintext: longProse("james beard finalists") },
        { title: "GOVERNMENT", plaintext: longProse("city council") },
      ];
      const kept = selectRelevantSections(sections);
      expect(kept.map((s) => s.title.toLowerCase())).toEqual(
        expect.arrayContaining(["culture and arts", "food and drink"]),
      );
      expect(kept.some((s) => s.title.toLowerCase() === "government")).toBe(false);
    });

    it("drops sections with less than ~80 chars of prose (stub content)", async () => {
      const { selectRelevantSections } = await import("../scrapers/wikipedia");
      const kept = selectRelevantSections([
        { title: "Culture", plaintext: "Too short." },
        { title: "Tourism", plaintext: "The riverwalk downtown hosts summer concerts and weekend farmers markets throughout the warmer months along the Cuyahoga bend." },
      ]);
      expect(kept.map((s) => s.title)).toEqual(["Tourism"]);
    });

    it("returns an empty array when given empty input (edge case)", async () => {
      const { selectRelevantSections } = await import("../scrapers/wikipedia");
      expect(selectRelevantSections([])).toEqual([]);
    });
  });

  describe("buildMarkdown", () => {
    it("emits a heading with city + country and includes each section as an H2", async () => {
      const { buildMarkdown } = await import("../scrapers/wikipedia");
      const city: WikiCity = { id: "akron", name: "Akron", country: "United States" };
      const md = buildMarkdown(city, [
        { title: "Culture", plaintext: "Rubber city murals. " + "x".repeat(200) },
        { title: "Neighborhoods", plaintext: "Highland Square. " + "x".repeat(200) },
      ]);
      expect(md).toMatch(/^# Wikipedia: Akron, United States/);
      expect(md).toMatch(/## Culture/);
      expect(md).toMatch(/## Neighborhoods/);
    });

    it(`produces output > MIN_MARKDOWN_LENGTH (${MIN_MARKDOWN_LENGTH}) for typical content`, async () => {
      const { buildMarkdown } = await import("../scrapers/wikipedia");
      const city: WikiCity = { id: "bend", name: "Bend", country: "United States" };
      const md = buildMarkdown(city, [
        { title: "Tourism", plaintext: "y".repeat(600) },
      ]);
      expect(md.length).toBeGreaterThan(MIN_MARKDOWN_LENGTH);
    });

    it("emits only the header when given no sections, without throwing", async () => {
      const { buildMarkdown } = await import("../scrapers/wikipedia");
      const city: WikiCity = { id: "x", name: "X", country: "Y" };
      const md = buildMarkdown(city, []);
      expect(md).toMatch(/^# Wikipedia: X, Y/);
      expect(md).not.toMatch(/^## /m);
    });
  });

  describe("buildStubJson (safe schema per audit Task 3)", () => {
    it("contains source, cityId, retrievedAt, placeCount — and NO empty places[] array", async () => {
      const { buildStubJson } = await import("../scrapers/wikipedia");
      const stub = buildStubJson({ id: "akron", name: "Akron", country: "United States" }, "wikipedia", 0);
      expect(stub).toHaveProperty("source", "wikipedia");
      expect(stub).toHaveProperty("cityId", "akron");
      expect(stub).toHaveProperty("retrievedAt");
      expect(stub).toHaveProperty("placeCount", 0);
      expect((stub as Record<string, unknown>).places).toBeUndefined();
    });

    it("retrievedAt is an ISO-8601 string", async () => {
      const { buildStubJson } = await import("../scrapers/wikipedia");
      const stub = buildStubJson({ id: "x", name: "X", country: "Y" }, "wikipedia", 3) as Record<string, unknown>;
      expect(typeof stub.retrievedAt).toBe("string");
      expect(Number.isFinite(Date.parse(stub.retrievedAt as string))).toBe(true);
    });
  });

  describe("retryWithBackoff (audit Task 2)", () => {
    it("retries on thrown error and returns the eventual success value", async () => {
      const { retryWithBackoff } = await import("../scrapers/wikipedia");
      let calls = 0;
      const result = await retryWithBackoff(
        async () => {
          calls++;
          if (calls < 3) throw new Error("429 rate limit");
          return "ok";
        },
        { maxAttempts: 4, baseMs: 1 },
      );
      expect(result).toBe("ok");
      expect(calls).toBe(3);
    });

    it("gives up after maxAttempts and propagates the last error", async () => {
      const { retryWithBackoff } = await import("../scrapers/wikipedia");
      let calls = 0;
      await expect(
        retryWithBackoff(
          async () => {
            calls++;
            throw new Error("always fails");
          },
          { maxAttempts: 3, baseMs: 1 },
        ),
      ).rejects.toThrow("always fails");
      expect(calls).toBe(3);
    });
  });
});
