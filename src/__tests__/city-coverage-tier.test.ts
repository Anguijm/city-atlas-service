import { describe, it, expect } from "vitest";
import globalCityCache from "@/configs/global_city_cache.json";

type CityEntry = {
  id: string;
  name: string;
  country: string;
  coverageTier?: "metro" | "town" | "village";
  maxRadiusKm?: number;
};

const cities = globalCityCache as CityEntry[];
const cityMap = new Map(cities.map((c) => [c.id, c]));

describe("City coverage tier schema", () => {
  it("every city has a coverageTier field", () => {
    const missing = cities.filter((c) => !c.coverageTier);
    expect(missing.map((c) => c.id)).toEqual([]);
  });

  it("every city has a maxRadiusKm field with a positive number", () => {
    const missing = cities.filter(
      (c) => typeof c.maxRadiusKm !== "number" || c.maxRadiusKm <= 0,
    );
    expect(missing.map((c) => c.id)).toEqual([]);
  });

  it("coverageTier values are restricted to metro|town|village", () => {
    const allowed = new Set(["metro", "town", "village"]);
    const bad = cities.filter((c) => !allowed.has(c.coverageTier!));
    expect(bad.map((c) => `${c.id}:${c.coverageTier}`)).toEqual([]);
  });

  it("has at least one city of each coverageTier (no vacuous pass)", () => {
    const tiers = new Set(cities.map((c) => c.coverageTier));
    expect(tiers.has("metro")).toBe(true);
    expect(tiers.has("town")).toBe(true);
    expect(tiers.has("village")).toBe(true);
  });

  it("metro cities have maxRadiusKm > 15 and <= 100", () => {
    const metros = cities.filter((c) => c.coverageTier === "metro");
    const bad = metros.filter(
      (c) => c.maxRadiusKm! <= 15 || c.maxRadiusKm! > 100,
    );
    expect(bad.map((c) => c.id)).toEqual([]);
  });

  it("town cities have maxRadiusKm > 5 and <= 15 (mutually exclusive with metro)", () => {
    const towns = cities.filter((c) => c.coverageTier === "town");
    const bad = towns.filter((c) => c.maxRadiusKm! <= 5 || c.maxRadiusKm! > 15);
    expect(bad.map((c) => c.id)).toEqual([]);
  });

  it("village cities have maxRadiusKm >= 1 and <= 5 (mutually exclusive with town)", () => {
    const villages = cities.filter((c) => c.coverageTier === "village");
    const bad = villages.filter((c) => c.maxRadiusKm! < 1 || c.maxRadiusKm! > 5);
    expect(bad.map((c) => c.id)).toEqual([]);
  });

  it("has at least 100 United States cities after expansion", () => {
    const us = cities.filter((c) => c.country === "United States");
    expect(us.length).toBeGreaterThanOrEqual(100);
  });

  it("all 50 new US cities are present with correct council-approved tiers", () => {
    // Council-approved tier assignments — every new city must match.
    const expectedTowns = [
      "spokane", "tulsa", "anchorage", "lexington", "omaha",
      "sacramento", "buffalo", "rochester-ny", "st-paul", "madison",
      "des-moines", "knoxville", "chattanooga", "little-rock", "birmingham-al",
      "baton-rouge", "reno", "worcester", "newark", "jersey-city",
      "colorado-springs", "grand-rapids", "dayton", "akron", "syracuse",
      "flint", "mobile", "virginia-beach", "fresno", "long-beach",
      "sioux-falls", "santa-barbara", "bend",
    ];
    const expectedVillages = [
      "asheville", "santa-fe", "missoula", "flagstaff", "taos",
      "sedona", "burlington-vt", "portland-me", "traverse-city", "ithaca",
      "marfa", "jackson-wy", "park-city", "boulder", "fairbanks",
      "key-west", "kahului",
    ];

    const mismatches: string[] = [];
    for (const id of expectedTowns) {
      const c = cityMap.get(id);
      if (!c) mismatches.push(`${id}: MISSING`);
      else if (c.coverageTier !== "town") mismatches.push(`${id}: expected town, got ${c.coverageTier}`);
    }
    for (const id of expectedVillages) {
      const c = cityMap.get(id);
      if (!c) mismatches.push(`${id}: MISSING`);
      else if (c.coverageTier !== "village") mismatches.push(`${id}: expected village, got ${c.coverageTier}`);
    }
    expect(mismatches).toEqual([]);
    expect(expectedTowns.length + expectedVillages.length).toBe(50);
  });

  it("new town cities have radius within the town range", () => {
    const newTowns = ["spokane", "sacramento", "santa-barbara", "bend"];
    for (const id of newTowns) {
      const c = cityMap.get(id);
      expect(c?.maxRadiusKm, `${id} maxRadiusKm`).toBeGreaterThan(5);
      expect(c?.maxRadiusKm, `${id} maxRadiusKm`).toBeLessThanOrEqual(15);
    }
  });

  it("new village cities have radius within the village range", () => {
    const newVillages = ["marfa", "taos", "kahului", "asheville"];
    for (const id of newVillages) {
      const c = cityMap.get(id);
      expect(c?.maxRadiusKm, `${id} maxRadiusKm`).toBeGreaterThanOrEqual(1);
      expect(c?.maxRadiusKm, `${id} maxRadiusKm`).toBeLessThanOrEqual(5);
    }
  });

  it("no duplicate city ids", () => {
    const ids = cities.map((c) => c.id);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });

  it("dropped cities are not present (Aurora CO, Anaheim CA, Bar Harbor ME, Toledo OH)", () => {
    const ids = new Set(cities.map((c) => c.id));
    const shouldNotExist = ["aurora", "anaheim", "bar-harbor", "toledo"];
    const present = shouldNotExist.filter((id) => ids.has(id));
    expect(present).toEqual([]);
  });
});
