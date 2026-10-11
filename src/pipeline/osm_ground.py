"""Phase C grounding against OpenStreetMap, for towns researched from it.

2026-10-11: Grand Island, NE was researched from an OSM listing plus one
Wikipedia paragraph. Of 25 waypoints, 19 were OSM places by name. Two were
invented outright ("The 'Hidden' Walkways"). The semantic audit, which sees
only a sample and no sources, deleted two real cafés from the listing as
"hallucinated". Its gaps run both ways.

When a city has an OSM listing, the listing is ground truth for existence:
- A waypoint with an OSM place's exact name is confirmed. It takes the place's
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
# Containment keeps a waypoint ("Wave Pizza Company" for OSM's "Wave Pizza")
# but never confirms it: "Old Scurry County Jail" contains the "Scurry County"
# marker, and "Route 66 Auto Museum" a restaurant called "Route 66".
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


def _name(waypoint: dict) -> str:
    name = waypoint.get("name")
    return (name.get("en") or "") if isinstance(name, dict) else (name or "")


def osm_match(waypoint: dict, places: list[dict]) -> dict | None:
    """The nearest OSM place with exactly the waypoint's (normalised) name."""
    n = norm(_name(waypoint))
    hits = [p for p in places if n and norm(p["name"]) == n]
    if not hits:
        return None
    lat, lng = waypoint.get("lat"), waypoint.get("lng")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        return min(hits, key=lambda p: haversine_km(lat, lng, p["lat"], p["lng"]))
    return hits[0]


def osm_contained(waypoint: dict, places: list[dict]) -> dict | None:
    """An OSM place whose name contains, or is contained in, the waypoint's."""
    n = norm(_name(waypoint))
    return next((p for p in places if n and _same_place(n, norm(p["name"]))), None)


def _describe_from_listing(waypoint: dict, place: dict) -> None:
    plain = plain_description(place)
    if plain:
        waypoint["description"] = {"en": plain}
    else:
        waypoint.pop("description", None)


def _mentions(corpus: str, name: str) -> bool:
    n = norm(name)
    return bool(n) and re.search(rf"\b{re.escape(n)}\b", corpus) is not None


def ground_waypoints(
    waypoints: list, places: list[dict], osm_text: str, other_text: str
) -> tuple[list, set[str], list[str]]:
    """Returns (kept waypoints, confirmed lowercased names, dropped names).

    Confirmed waypoints are snapped to the OSM position. A waypoint whose
    name only contains (or is contained in) an OSM place's is kept
    unconfirmed and unmoved. One named in some other source is kept as is.
    One named nowhere is dropped. Whatever no non-OSM source mentions is
    described from the listing, or not at all.
    """
    corpus, others = norm(osm_text + "\n" + other_text), norm(other_text)
    kept, confirmed, dropped = [], set(), []
    for w in waypoints:
        if not isinstance(w, dict):
            kept.append(w)
            continue
        name = _name(w)
        hit = osm_match(w, places)
        if hit:
            w["lat"], w["lng"] = hit["lat"], hit["lng"]
            if not _mentions(others, name):
                _describe_from_listing(w, hit)
            # The mapped spelling and case ("The Chocolate bar" -> OSM's).
            w["name"] = {**w["name"], "en": hit["name"]} if isinstance(w.get("name"), dict) else hit["name"]
            confirmed.add(hit["name"].strip().lower())
            kept.append(w)
        elif (near := osm_contained(w, places)) is not None:
            # Kept unconfirmed and unmoved, but the listing still says what
            # the place is better than Gemini did: "Wave Pizza Company" was
            # "perpetually lively" on no evidence.
            if not _mentions(others, name):
                _describe_from_listing(w, near)
            kept.append(w)
        elif _mentions(corpus, name):
            kept.append(w)
        else:
            dropped.append(name)
    return kept, confirmed, dropped
