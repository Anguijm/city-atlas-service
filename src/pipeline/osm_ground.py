"""Phase C grounding against OpenStreetMap, for towns researched from it.

2026-10-11: Grand Island, NE was researched from an OSM listing plus one
Wikipedia paragraph. Of 25 waypoints, 19 were OSM places by name. Two were
invented outright ("The 'Hidden' Walkways"). The semantic audit, which sees
only a sample and no sources, deleted two real cafés from the listing as
"hallucinated". Its gaps run both ways.

When a city has an OSM listing, the listing is ground truth for existence:
- A waypoint named like an OSM place is confirmed. It takes the place's
  mapped position, and the audit may not delete it.
- A waypoint whose name appears in no source at all is dropped.
- A confirmed waypoint that no other source mentions gets a plain
  description from the listing ("Restaurant on West Koenig Street.").
  Gemini's own was a guess: it called The Chocolate Bar, a restaurant, a
  chocolatier. Roadtripper shows descriptions under each name.
"""
from __future__ import annotations

import re
import unicodedata

from spatial_check import haversine_km

# `- **Name** — kind — [address — ]lat, lng[ — website]`
_LINE = re.compile(r"^- \*\*(?P<name>.+?)\*\* — (?P<rest>.*)$")
_COORD = re.compile(r"(-?\d+\.\d+), (-?\d+\.\d+)")

# A shorter name must be this long to count as contained in a longer one.
# "Wave Pizza" inside "Wave Pizza Company" counts; "Bar" inside "Balz Sports
# Bar" does not.
MIN_CONTAINED_CHARS = 8


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"^the ", "", s.strip())
    return s.strip()


def parse_osm_markdown(text: str) -> list[dict]:
    places = []
    for line in text.splitlines():
        m = _LINE.match(line.strip())
        if not m:
            continue
        c = _COORD.search(m.group("rest"))
        if not c:
            continue
        parts = [x.strip() for x in m.group("rest").split(" — ")]
        coord_at = next(i for i, x in enumerate(parts) if _COORD.fullmatch(x))
        places.append({
            "name": m.group("name"),
            "lat": float(c.group(1)),
            "lng": float(c.group(2)),
            "kind": parts[0] if coord_at > 0 else "",
            "address": parts[1] if coord_at > 1 else "",
        })
    return places


def plain_description(place: dict) -> str | None:
    """"Cafe on North Walnut Street.", or None when no street is mapped:
    a bare "Restaurant." repeats the waypoint's type and says nothing."""
    street = re.sub(r"^\d+[A-Za-z]?\s+", "", place.get("address") or "")
    if not street:
        return None
    return f"{(place.get('kind') or 'place').capitalize()} on {street}."


def _same_place(a: str, b: str) -> bool:
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    return len(short) >= MIN_CONTAINED_CHARS and re.search(rf"\b{re.escape(short)}\b", long_) is not None


def osm_match(waypoint: dict, places: list[dict]) -> dict | None:
    """The nearest OSM place with the waypoint's name, or None."""
    name = waypoint.get("name")
    if isinstance(name, dict):
        name = name.get("en") or ""
    n = norm(name or "")
    if not n:
        return None
    hits = [p for p in places if _same_place(n, norm(p["name"]))]
    if not hits:
        return None
    lat, lng = waypoint.get("lat"), waypoint.get("lng")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        return min(hits, key=lambda p: haversine_km(lat, lng, p["lat"], p["lng"]))
    return hits[0]


def _mentions(corpus: str, name: str) -> bool:
    n = norm(name)
    return bool(n) and re.search(rf"\b{re.escape(n)}\b", corpus) is not None


def ground_waypoints(
    waypoints: list, places: list[dict], osm_text: str, other_text: str
) -> tuple[list, set[str], list[str]]:
    """Returns (kept waypoints, confirmed lowercased names, dropped names).

    Confirmed waypoints are snapped to the OSM position. A waypoint that is
    not an OSM place but is named in some source is kept unconfirmed: the
    other sources still count. One named nowhere is dropped.
    """
    corpus, others = norm(osm_text + "\n" + other_text), norm(other_text)
    kept, confirmed, dropped = [], set(), []
    for w in waypoints:
        if not isinstance(w, dict):
            kept.append(w)
            continue
        name = w.get("name")
        name = (name.get("en") or "") if isinstance(name, dict) else (name or "")
        hit = osm_match(w, places)
        if hit:
            w["lat"], w["lng"] = hit["lat"], hit["lng"]
            if not _mentions(others, name) and not _mentions(others, hit["name"]):
                plain = plain_description(hit)
                if plain:
                    w["description"] = {"en": plain}
                else:
                    w.pop("description", None)
            # The mapped spelling, not Gemini's ("Wave Pizza Company").
            w["name"] = {**w["name"], "en": hit["name"]} if isinstance(w.get("name"), dict) else hit["name"]
            confirmed.add(hit["name"].strip().lower())
            kept.append(w)
        elif _mentions(corpus, name):
            kept.append(w)
        else:
            dropped.append(name)
    return kept, confirmed, dropped
