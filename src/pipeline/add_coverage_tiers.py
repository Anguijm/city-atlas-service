#!/usr/bin/env python3
"""
Add coverageTier + maxRadiusKm to all existing cities (default metro/25km)
and append 50 new US cities per council approval.

Run once:
  python3 src/pipeline/add_coverage_tiers.py
"""

import json
from pathlib import Path

# Resolve relative to the repo root so the script works regardless of cwd.
PATH = Path(__file__).parent.parent.parent / "configs" / "global_city_cache.json"

# Tier defaults
METRO_RADIUS = 25
TOWN_RADIUS = 10
VILLAGE_RADIUS = 3

# Council-approved 50 new US cities with tier assignments.
# Format: (id, name, vernacular, lat, lng, vibeClass, lore, tier_code)
# tier_code: 'T' = town, 'V' = village
NEW_CITIES = [
    # TOWN TIER (33)
    ("spokane", "Spokane", "The Lilac City", 47.6588, -117.4260, "BRUTAL_GRIT",
     "Inland Northwest railroad town with a walkable Riverfront Park and a surprising craft beer scene.", "T"),
    ("tulsa", "Tulsa", "Oil Capital of the World", 36.1540, -95.9928, "DECAY_CHIC",
     "Art Deco masterpieces from the oil boom, Bob Dylan Center, and a reborn Route 66 downtown.", "T"),
    ("anchorage", "Anchorage", "City of Lights and Flowers", 61.2181, -149.9003, "BRUTAL_GRIT",
     "Alaska's frontier hub where seaplanes, moose, and downtown craft breweries coexist.", "T"),
    ("lexington", "Lexington", "Horse Capital of the World", 38.0406, -84.5037, "FLUID_TROPIC",
     "Bluegrass country — horse farms, bourbon trail, and a walkable antebellum downtown.", "T"),
    ("omaha", "Omaha", "The Big O", 41.2565, -95.9345, "DECAY_CHIC",
     "Old Market cobblestones, Warren Buffett's hometown, and the country's best steakhouses.", "T"),
    ("sacramento", "Sacramento", "The River City", 38.5816, -121.4944, "DECAY_CHIC",
     "California's state capital — Midtown farm-to-table, Gold Rush history, and Tower Bridge sunsets.", "T"),
    ("buffalo", "Buffalo", "Queen City of the Lakes", 42.8864, -78.8784, "BRUTAL_GRIT",
     "Frank Lloyd Wright architecture, chicken wing birthplace, and a Great Lakes waterfront reborn.", "T"),
    ("rochester-ny", "Rochester", "Flower City", 43.1566, -77.6088, "DECAY_CHIC",
     "Kodak's hometown, Susan B. Anthony's base, and a canal town with a killer public market.", "T"),
    ("st-paul", "Saint Paul", "The Capital City", 44.9537, -93.0900, "NEON_GRID",
     "Minneapolis's quieter twin — F. Scott Fitzgerald's haunts, Cathedral Hill, and riverfront parks.", "T"),
    ("madison", "Madison", "Mad City", 43.0731, -89.4012, "NEON_GRID",
     "Isthmus capital flanked by two lakes, a farmers market around the Capitol, and Wisconsin cheese culture.", "T"),
    ("des-moines", "Des Moines", "Hartford of the West", 41.5868, -93.6250, "NEON_GRID",
     "Iowa's capital with a surprisingly robust downtown, East Village arts, and the State Fair.", "T"),
    ("knoxville", "Knoxville", "Marble City", 35.9606, -83.9207, "DECAY_CHIC",
     "Market Square heart, Sunsphere icon, and the gateway to Great Smoky Mountains.", "T"),
    ("chattanooga", "Chattanooga", "Scenic City", 35.0456, -85.3097, "DECAY_CHIC",
     "Lookout Mountain, the country's first pedestrian bridge, and a walkable riverfront renaissance.", "T"),
    ("little-rock", "Little Rock", "The Rock", 34.7465, -92.2896, "BRUTAL_GRIT",
     "Arkansas River capital with Clinton Library, Central High civil rights history, and Delta BBQ.", "T"),
    ("birmingham-al", "Birmingham", "The Magic City", 33.5186, -86.8104, "BRUTAL_GRIT",
     "Iron furnace heritage, civil rights landmarks, and a Southern food scene punching above its weight.", "T"),
    ("baton-rouge", "Baton Rouge", "Red Stick", 30.4515, -91.1871, "FLUID_TROPIC",
     "Louisiana capital with Cajun-Creole food, LSU tiger culture, and Mississippi River levees.", "T"),
    ("reno", "Reno", "The Biggest Little City in the World", 39.5296, -119.8138, "NEON_GRID",
     "Desert casino town reborn as a Burning Man gateway with Truckee River kayaking.", "T"),
    ("worcester", "Worcester", "The Heart of the Commonwealth", 42.2626, -71.8023, "DECAY_CHIC",
     "Massachusetts second city with diner history, Dinosaur Rock, and a thriving canal district.", "T"),
    ("newark", "Newark", "Brick City", 40.7357, -74.1724, "BRUTAL_GRIT",
     "NYC's scrappy neighbor — Portuguese Ironbound, NJPAC, and the country's largest cherry blossom festival.", "T"),
    ("jersey-city", "Jersey City", "JC", 40.7178, -74.0431, "NEON_GRID",
     "Manhattan's waterfront foil with Liberty State Park, Indian grocers, and skyline views better than NYC itself.", "T"),
    ("colorado-springs", "Colorado Springs", "The Springs", 38.8339, -104.8214, "BRUTAL_GRIT",
     "Pikes Peak's doorstep — Garden of the Gods red rocks, Air Force Academy, and Manitou mineral waters.", "T"),
    ("grand-rapids", "Grand Rapids", "Beer City USA", 42.9634, -85.6681, "DECAY_CHIC",
     "West Michigan brewery capital with ArtPrize, Meijer Gardens, and furniture design heritage.", "T"),
    ("dayton", "Dayton", "Birthplace of Aviation", 39.7589, -84.1916, "BRUTAL_GRIT",
     "Wright Brothers' city with an Air Force museum, Oregon District nightlife, and funk music roots.", "T"),
    ("akron", "Akron", "Rubber City", 41.0814, -81.5190, "BRUTAL_GRIT",
     "LeBron's hometown — Goodyear blimp origins, Stan Hywet estate, and a Canal District rebirth.", "T"),
    ("syracuse", "Syracuse", "Salt City", 43.0481, -76.1474, "DECAY_CHIC",
     "Erie Canal heritage, Armory Square nightlife, and orange Syracuse University basketball culture.", "T"),
    ("flint", "Flint", "Vehicle City", 43.0125, -83.6875, "BRUTAL_GRIT",
     "Buick birthplace and sit-down strike origin — a resilient post-industrial city with a college-town core.", "T"),
    ("mobile", "Mobile", "The Azalea City", 30.6954, -88.0399, "FLUID_TROPIC",
     "America's original Mardi Gras city, antebellum Oakleigh, and Gulf Coast seafood shacks.", "T"),
    ("virginia-beach", "Virginia Beach", "VB", 36.8529, -75.9780, "FLUID_TROPIC",
     "Three-mile boardwalk, First Landing State Park, and the largest Naval base in the world next door.", "T"),
    ("fresno", "Fresno", "The Raisin Capital", 36.7378, -119.7871, "FLUID_TROPIC",
     "Central Valley ag hub with Tower District arts, Forestiere Underground Gardens, and Mexican-American food legacy.", "T"),
    ("long-beach", "Long Beach", "The LBC", 33.7701, -118.1937, "FLUID_TROPIC",
     "Queen Mary, Cambodia Town, Snoop's hometown — a gritty-chic coastal city Los Angeles often ignores.", "T"),
    ("sioux-falls", "Sioux Falls", "The Falls City", 43.5460, -96.7313, "DECAY_CHIC",
     "Namesake waterfall in a walkable downtown, Phillips Avenue sculpture walk, and Dakota plains gateway.", "T"),
    ("santa-barbara", "Santa Barbara", "The American Riviera", 34.4208, -119.6982, "FLUID_TROPIC",
     "Spanish Mission whitewash, Mediterranean climate, and a Stearns Wharf sunset that launched a thousand Instagram posts.", "T"),
    ("bend", "Bend", "Beer Town USA", 44.0582, -121.3153, "BRUTAL_GRIT",
     "High desert brewery mecca with a walkable Old Mill District and Deschutes River paddleboarding.", "T"),

    # VILLAGE TIER (17)
    ("asheville", "Asheville", "Beer City", 35.5951, -82.5515, "DECAY_CHIC",
     "Blue Ridge bohemian capital — Biltmore Estate, River Arts District, and the south's densest brewery cluster.", "V"),
    ("santa-fe", "Santa Fe", "The City Different", 35.6870, -105.9378, "FLUID_TROPIC",
     "Adobe Plaza, Georgia O'Keeffe's country, and the highest-altitude state capital in America.", "V"),
    ("missoula", "Missoula", "Garden City", 46.8721, -113.9940, "BRUTAL_GRIT",
     "Clark Fork riverfront, University of Montana, and the spiritual home of fly fishing literature.", "V"),
    ("flagstaff", "Flagstaff", "The City of Seven Wonders", 35.1983, -111.6513, "BRUTAL_GRIT",
     "Route 66 mountain town, Lowell Observatory where Pluto was found, and Grand Canyon gateway.", "V"),
    ("taos", "Taos", "Soul of the Southwest", 36.4072, -105.5731, "FLUID_TROPIC",
     "Thousand-year-old pueblo, DH Lawrence ranch, and a mountain arts colony at 7,000 feet.", "V"),
    ("sedona", "Sedona", "Red Rock Country", 34.8697, -111.7610, "FLUID_TROPIC",
     "Sandstone cathedrals, Oak Creek canyon, and new-age vortex mysticism in a postcard landscape.", "V"),
    ("burlington-vt", "Burlington", "The Queen City", 44.4759, -73.2121, "DECAY_CHIC",
     "Lake Champlain sunsets, Church Street Marketplace, and Ben & Jerry's Vermont progressive spirit.", "V"),
    ("portland-me", "Portland", "Forest City", 43.6591, -70.2568, "DECAY_CHIC",
     "Maine's cobblestone Old Port, lobster shacks on every corner, and a food scene that rivals cities ten times its size.", "V"),
    ("traverse-city", "Traverse City", "Cherry Capital", 44.7631, -85.6206, "FLUID_TROPIC",
     "Lake Michigan bay town with tart cherry orchards, Sleeping Bear Dunes, and a film festival in July.", "V"),
    ("ithaca", "Ithaca", "Gorges", 42.4440, -76.5019, "DECAY_CHIC",
     "Cornell University Finger Lakes town with waterfalls you can walk to and a Moosewood vegetarian legacy.", "V"),
    ("marfa", "Marfa", "The Marfa Lights", 30.3093, -104.0206, "FLUID_TROPIC",
     "Donald Judd's minimalist ghost town in the high desert, mysterious lights, and impossibly distant horizons.", "V"),
    ("jackson-wy", "Jackson", "Hole of the World", 43.4799, -110.7624, "BRUTAL_GRIT",
     "Tetons gateway with antler arches, skiing legends, and the George Bush Intercontinental of dude ranches.", "V"),
    ("park-city", "Park City", "Utah's Original Mining Town", 40.6461, -111.4980, "BRUTAL_GRIT",
     "Silver boom to Sundance — Main Street saloons, Olympic legacy, and powder skiing from the door.", "V"),
    ("boulder", "Boulder", "The Republic of Boulder", 40.0150, -105.2705, "FLUID_TROPIC",
     "Flatirons rising over Pearl Street, Celestial Seasonings HQ, and the most PhDs per capita in America.", "V"),
    ("fairbanks", "Fairbanks", "Golden Heart City", 64.8378, -147.7164, "BRUTAL_GRIT",
     "Aurora borealis viewing capital, dog mushing heritage, and Alaska's interior at 40 below zero.", "V"),
    ("key-west", "Key West", "Conch Republic", 24.5551, -81.7800, "FLUID_TROPIC",
     "Hemingway's six-toed cats, Mallory Square sunsets, and Duval Street revelry at the southernmost point.", "V"),
    ("kahului", "Kahului", "Valley Isle Gateway", 20.8893, -156.4729, "FLUID_TROPIC",
     "Maui's practical heart — Iao Valley rainforest, Paia surf town nearby, and the road to Hana starts here.", "V"),
]


def main():
    data = json.load(open(PATH))
    print(f"Loaded {len(data)} existing cities")

    existing_ids = {c["id"] for c in data}

    # Backfill existing cities with default metro/25km
    backfilled = 0
    for c in data:
        if "coverageTier" not in c:
            c["coverageTier"] = "metro"
            backfilled += 1
        if "maxRadiusKm" not in c:
            c["maxRadiusKm"] = METRO_RADIUS

    print(f"Backfilled {backfilled} existing cities with coverageTier=metro, maxRadiusKm=25")

    # Append new cities
    added = 0
    skipped = 0
    for entry in NEW_CITIES:
        city_id, name, vern, lat, lng, vibe, lore, tier_code = entry
        if city_id in existing_ids:
            print(f"  ⚠ {city_id} already exists, skipping")
            skipped += 1
            continue
        coverage_tier = "town" if tier_code == "T" else "village"
        radius = TOWN_RADIUS if tier_code == "T" else VILLAGE_RADIUS
        data.append({
            "id": city_id,
            "name": name,
            "clinicalName": name,
            "vernacularName": vern,
            "country": "United States",
            "region": "north-america",
            "lat": lat,
            "lng": lng,
            "tier": "tier3",
            "vibeClass": vibe,
            "noiseBaseline": 0.035,
            "isArchived": False,
            "loreAnchor": lore,
            "qualityStatus": "pending_review",
            "coverageTier": coverage_tier,
            "maxRadiusKm": radius,
        })
        added += 1

    json.dump(data, open(PATH, "w"), indent=2, ensure_ascii=False)

    us_count = sum(1 for c in data if c.get("country") == "United States")
    print(f"\nAdded {added} new cities, skipped {skipped}")
    print(f"Total cities: {len(data)}")
    print(f"US cities: {us_count}")
    print(f"By tier: metro={sum(1 for c in data if c.get('coverageTier')=='metro')}, "
          f"town={sum(1 for c in data if c.get('coverageTier')=='town')}, "
          f"village={sum(1 for c in data if c.get('coverageTier')=='village')}")


if __name__ == "__main__":
    main()
