import { describe, it, expect } from "vitest";
import { buildMarkdown, kindOf, MAX_PLACES, overpassQuery, toPlaces, type OsmElement } from "../scrapers/osm";

const town = { id: "grand-island-ne", name: "Grand Island", lat: 40.9264, lng: -98.342, maxRadiusKm: 10 };

function node(id: number, tags: Record<string, string>, lat = 40.92, lon = -98.34): OsmElement {
  return { type: "node", id, lat, lon, tags };
}

describe("scrape-osm", () => {
  it("asks for places within the town's own radius", () => {
    const q = overpassQuery(town);
    expect(q).toContain("around:10000,40.9264,-98.342");
    expect(overpassQuery({ ...town, maxRadiusKm: 3 })).toContain("around:3000,");
  });

  it("names each place's kind, sights included", () => {
    expect(kindOf({ tourism: "museum" })).toBe("museum");
    expect(kindOf({ tourism: "theme_park" })).toBe("theme park");
    expect(kindOf({ historic: "memorial" })).toBe("historic site");
    expect(kindOf({ amenity: "ice_cream" })).toBe("ice cream");
    expect(kindOf({ tourism: "hotel" })).toBeNull();
    expect(kindOf({ amenity: "fuel" })).toBeNull();
  });

  it("drops places with no name, no kind or no position, and repeats", () => {
    const places = toPlaces([
      node(1, { tourism: "museum", name: "Stuhr Museum" }),
      { type: "way", id: 2, center: { lat: 40.9, lon: -98.3 }, tags: { tourism: "museum", name: "Stuhr Museum" } },
      node(3, { tourism: "museum" }),
      node(4, { tourism: "hotel", name: "Motel 6" }),
      { type: "way", id: 5, tags: { amenity: "cafe", name: "No Centre" } },
      { type: "way", id: 6, center: { lat: 40.91, lon: -98.33 }, tags: { amenity: "cafe", name: "Coffee Shop" } },
    ]);
    expect(places.map((p) => p.name)).toEqual(["Stuhr Museum", "Coffee Shop"]);
    expect(places[1]).toMatchObject({ lat: 40.91, lng: -98.33 });
  });

  it("lists sights before food, so the cap drops diners, not the museum", () => {
    const diners = Array.from({ length: MAX_PLACES + 5 }, (_, i) =>
      node(100 + i, { amenity: "restaurant", name: `Diner ${String(i).padStart(3, "0")}` }));
    const places = toPlaces([...diners, node(9, { tourism: "museum", name: "Zz Museum" })]);
    expect(places).toHaveLength(MAX_PLACES);
    expect(places[0].name).toBe("Zz Museum");
  });

  it("writes one line per place with its position", () => {
    const md = buildMarkdown(town, toPlaces([
      node(1, { tourism: "museum", name: "Stuhr Museum", "addr:housenumber": "3133", "addr:street": "West Highway 34" }, 40.88712, -98.37291),
    ]));
    expect(md).toContain("# OpenStreetMap: Grand Island");
    expect(md).toContain("- **Stuhr Museum** — museum — 3133 West Highway 34 — 40.88712, -98.37291");
  });
});
