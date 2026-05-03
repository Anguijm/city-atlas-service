import { describe, it, expect } from "vitest";
import {
  US_STATE_SLUGS,
  buildAtlasUrls,
  extractPlacesFromText,
} from "../scrapers/atlas-obscura";

// Minimal City shape — matches the interface defined in atlas-obscura.ts.
type TestCity = {
  id: string;
  name: string;
  country: string;
  clinicalName?: string;
};

describe("US_STATE_SLUGS", () => {
  it("covers all 50 US states", () => {
    const twoLetterCodes = Object.keys(US_STATE_SLUGS);
    expect(twoLetterCodes).toHaveLength(50);
    // Spot-check a few
    expect(US_STATE_SLUGS["az"]).toBe("arizona");
    expect(US_STATE_SLUGS["nc"]).toBe("north-carolina");
    expect(US_STATE_SLUGS["nd"]).toBe("north-dakota");
    expect(US_STATE_SLUGS["wv"]).toBe("west-virginia");
  });

  it("uses hyphenated slugs for multi-word state names", () => {
    const multiWord = Object.values(US_STATE_SLUGS).filter((v) => v.includes("-"));
    expect(multiWord.length).toBeGreaterThan(0);
    // All must be lowercase with hyphens, no spaces
    multiWord.forEach((v) => {
      expect(v).toBe(v.toLowerCase());
      expect(v).not.toContain(" ");
    });
  });
});

describe("buildAtlasUrls", () => {
  it("puts override slug first when present", () => {
    const city: TestCity = { id: "bisbee-az", name: "Bisbee", country: "United States" };
    const urls = buildAtlasUrls(city, { "bisbee-az": "bisbee-arizona-custom" });
    expect(urls[0]).toBe("https://www.atlasobscura.com/things-to-do/bisbee-arizona-custom");
  });

  it("generates US state pattern for cities with two-letter state suffix in id", () => {
    const city: TestCity = { id: "bisbee-az", name: "Bisbee", country: "United States" };
    const urls = buildAtlasUrls(city, {});
    expect(urls).toContain("https://www.atlasobscura.com/things-to-do/bisbee-arizona");
  });

  it("generates US state pattern for cities with clinicalName comma (no id suffix)", () => {
    // city.id ends in "al" which IS in US_STATE_SLUGS, but test the clinicalName path
    // by using a city id whose suffix is not a known state code.
    const city: TestCity = {
      id: "birmingham",
      name: "Birmingham",
      country: "United States",
      clinicalName: "Birmingham, Alabama",
    };
    const urls = buildAtlasUrls(city, {});
    expect(urls).toContain("https://www.atlasobscura.com/things-to-do/birmingham-alabama");
  });

  it("falls back to country slug for non-US cities", () => {
    const city: TestCity = { id: "kyoto", name: "Kyoto", country: "Japan" };
    const urls = buildAtlasUrls(city, {});
    expect(urls).toContain("https://www.atlasobscura.com/things-to-do/kyoto-japan");
    expect(urls).toContain("https://www.atlasobscura.com/things-to-do/kyoto");
  });

  it("strips -city suffix in alt slug", () => {
    const city: TestCity = { id: "new-york-city", name: "New York City", country: "United States" };
    const urls = buildAtlasUrls(city, {});
    expect(urls).toContain("https://www.atlasobscura.com/things-to-do/new-york");
  });

  it("uses saigon alt slug for ho-chi-minh", () => {
    const city: TestCity = { id: "ho-chi-minh", name: "Ho Chi Minh", country: "Vietnam" };
    const urls = buildAtlasUrls(city, {});
    expect(urls).toContain("https://www.atlasobscura.com/things-to-do/saigon");
  });

  it("does not include US state pattern for non-US cities", () => {
    const city: TestCity = { id: "oxford", name: "Oxford", country: "United Kingdom" };
    const urls = buildAtlasUrls(city, {});
    // No state slug appended — id suffix "oxford" isn't in US_STATE_SLUGS
    urls.forEach((url) => {
      expect(url).not.toMatch(/oxford-(alabama|arkansas|arizona)/);
    });
  });
});

describe("extractPlacesFromText", () => {
  it("returns empty array for text with no matching pattern", () => {
    const places = extractPlacesFromText("No matching content here.", "Kyoto");
    expect(places).toHaveLength(0);
  });

  it("deduplicates places appearing multiple times", () => {
    // Simulate Atlas Obscura page text that repeats a place (sidebar + main listing)
    const line = "KYOTO, JAPAN";
    const text = [line, "Nishiki Market", "A famous market", line, "Nishiki Market", "A famous market"].join("\n");
    const places = extractPlacesFromText(text, "Kyoto");
    const names = places.map((p) => p.name);
    expect(names.filter((n) => n === "Nishiki Market")).toHaveLength(1);
  });

  it("filters out permanently closed venues", () => {
    // Atlas Obscura renders "PERMANENTLY CLOSED" as a standalone label BEFORE
    // the location/name pair — typically 3-5 lines prior after UI noise.
    // The lookback window check must catch it regardless of exact spacing.
    const locLine = "MIAMI, FLORIDA";
    const text = [
      // Closed venue: PERMANENTLY CLOSED label precedes the location trigger
      "PERMANENTLY CLOSED",
      "Been Here?",
      "Want to Visit?",
      "Add to List",
      locLine, "Burger Museum", "A shrine to fast food.",
      // Open venue: no closed label
      locLine, "Vizcaya Museum and Gardens", "An opulent villa estate.",
    ].join("\n");
    const places = extractPlacesFromText(text, "Miami");
    expect(places.map((p) => p.name)).not.toContain("Burger Museum");
    expect(places.map((p) => p.name)).toContain("Vizcaya Museum and Gardens");
  });

  it("filters out UI noise entries", () => {
    const line = "PARIS, FRANCE";
    const text = [
      line, "Been Here", "",
      line, "Want to Visit", "",
      line, "Add to List", "",
      line, "Shakespeare and Company", "A legendary bookshop.",
    ].join("\n");
    const places = extractPlacesFromText(text, "Paris");
    expect(places.map((p) => p.name)).not.toContain("Been Here");
    expect(places.map((p) => p.name)).toContain("Shakespeare and Company");
  });
});
