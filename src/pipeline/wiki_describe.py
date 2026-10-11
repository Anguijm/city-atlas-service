"""Wikipedia's first sentence for places the OSM listing could only name.

2026-10-11 (U48): OSM grounding leaves a place it alone knows with a plain
line ("Museum on US-34.") or no description. Rawlins' pick, Wyoming
Frontier Prison, showed its name and nothing else. Wikipedia has articles for
a few such places, the sights that matter most (9 of 87 in the ten OSM
towns), and its first sentence is a sourced description.

A sentence is used only when:
- the waypoint's description came from the listing or is missing (never
  replacing another source's);
- the article's title is the place's exact name, directly or by redirect
  ("Wyoming Frontier Prison" -> "Wyoming State Penitentiary"), and is not a
  disambiguation page;
- the article's coordinates are within MAX_KM of the town, so a same-named
  place elsewhere cannot lend its description;
- the sentence is at most MAX_CHARS. Roadtripper never cuts a description,
  so a longer one would wrap to six lines.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Callable

from spatial_check import haversine_km

MAX_KM = 10
MAX_CHARS = 240
BATCH = 20  # the MediaWiki API's limit for extracts per query
USER_AGENT = "city-atlas-service/0.1 (+https://github.com/Anguijm/city-atlas-service; ops@anguijm.dev)"

Fetch = Callable[[dict], dict]


def wants_description(w: object) -> bool:
    return isinstance(w, dict) and (not w.get("description") or w.get("description_source") == "osm")


def _name(w: dict) -> str:
    n = w.get("name")
    return ((n.get("en") or "") if isinstance(n, dict) else (n or "")).strip()


def lookup(names: list[str], fetch: Fetch) -> dict[str, dict]:
    """name -> {"title", "lat", "lng", "extract"} for names with a usable article."""
    found: dict[str, dict] = {}
    for i in range(0, len(names), BATCH):
        chunk = names[i:i + BATCH]
        q = fetch({
            "action": "query", "titles": "|".join(chunk), "redirects": 1,
            "prop": "coordinates|extracts|pageprops", "exintro": 1, "explaintext": 1,
            "exsentences": 1, "exlimit": BATCH, "format": "json",
        }).get("query", {})
        hops = {x["from"]: x["to"] for x in q.get("normalized", []) + q.get("redirects", [])}
        pages = {p.get("title"): p for p in q.get("pages", {}).values()}
        for name in chunk:
            title = name
            for _ in range(3):  # normalised, then redirected
                title = hops.get(title, title)
            p = pages.get(title)
            if not p or "missing" in p or "disambiguation" in p.get("pageprops", {}):
                continue
            co = (p.get("coordinates") or [None])[0]
            extract = (p.get("extract") or "").strip()
            if co and extract:
                found[name] = {"title": title, "lat": co["lat"], "lng": co["lon"], "extract": extract}
    return found


def describe_from_wikipedia(waypoints: list, town_lat: float, town_lng: float, fetch: Fetch) -> list[tuple[str, str]]:
    """Mutates waypoints; returns (place name, article title) for each described."""
    wanted = [w for w in waypoints if wants_description(w) and _name(w)]
    if not wanted:
        return []
    found = lookup(sorted({_name(w) for w in wanted}), fetch)
    described = []
    for w in wanted:
        hit = found.get(_name(w))
        if not hit or len(hit["extract"]) > MAX_CHARS:
            continue
        if haversine_km(town_lat, town_lng, hit["lat"], hit["lng"]) > MAX_KM:
            continue
        w["description"] = {"en": hit["extract"]}
        w["description_source"] = "wikipedia"
        described.append((_name(w), hit["title"]))
    return described


def http_fetch(params: dict) -> dict:
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)
