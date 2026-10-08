"""Phase C spatial check: places far from the city they were researched for.

2026-10-08: sweetwater-tx was ingested with five places in Sweetwater, FL,
a Miami suburb 2,080 km away. The Infatuation scraper fetched the wrong
Sweetwater; Phase A and B built a guide from it; the semantic audit, which
checks places against the city's *name*, passed it. Coordinates are the one
thing a same-name mix-up cannot fake, so they are checked against the
registry's own point.
"""
from __future__ import annotations

import math

# A place this far beyond the city's walkable radius is not in the city.
# Three radii, never under 30 km: a metro's 25 km radius allows 75 km of
# suburbs; a village's 3 km allows 30, its county seat's outskirts.
RADIUS_MULTIPLE = 3
MIN_LIMIT_KM = 30


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = math.radians
    a = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lng2 - lng1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def limit_km(city: dict) -> float:
    return max(RADIUS_MULTIPLE * float(city.get("maxRadiusKm") or 0), MIN_LIMIT_KM)


def far_places(city: dict, items: list, kind: str) -> list[str]:
    """One error per item with coordinates farther than limit_km(city) from the city's point."""
    if city.get("lat") is None or city.get("lng") is None:
        return []
    lim = limit_km(city)
    errors = []
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        lat, lng = it.get("lat"), it.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        d = haversine_km(city["lat"], city["lng"], lat, lng)
        if d > lim:
            errors.append(f"{kind} '{it.get('id', i)}' is {d:.0f} km from {city.get('name', city.get('id'))} (limit {lim:.0f} km): wrong place?")
    return errors
