"""Wikipedia's first sentence for places the OSM listing could only name.

2026-10-11 (U48): OSM grounding leaves a place it alone knows with a plain
line ("Museum on US-34.") or no description. Rawlins' pick, Wyoming
Frontier Prison, showed its name and nothing else. Wikipedia has articles for
a few such places, the sights that matter most (9 of 87 in the ten OSM
towns), and its first sentence is a sourced description.

A sentence is used only when:
- the waypoint's description came from the listing or is missing (never
  replacing another source's);
- the article is about the place by name: its title is the place's name,
  or one contains the other ("Stuhr Museum of the Prairie Pioneer"
  redirects to "Stuhr Museum"). A redirect to a broader subject is refused:
  "Wyoming Frontier Prison" redirects to "Wyoming State Penitentiary", whose
  first sentence ("historic and current prison") read to the U48 critic as
  a working prison a driver can't visit, worse than no line;
- it is not a disambiguation page;
- the article's coordinates are within MAX_KM of the town, so a same-named
  place elsewhere cannot lend its description;
- the sentence is at most MAX_CHARS. Roadtripper never cuts a description,
  so a longer one would wrap to six lines.

2026-11-10 (U49): the sentence is trimmed of what Roadtripper's screen
already shows (trim_lead). The place's name sits above its line and the town
above both, so "Fonner Park is a thoroughbred horse racing facility located
in Grand Island, Nebraska." said two of its three things twice. The trim only
deletes words, never rewrites, so the line is still Wikipedia's.
"""
from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from typing import Callable

from spatial_check import haversine_km

# A town's own sights sit within its radius (3–10 km in the registry); 10 km
# keeps a same-named place in another state from lending its sentence.
MAX_KM = 10
# Roadtripper wraps a description whole and never cuts it; 240 characters is
# about five lines on a 390 px phone, the longest the atlas held before OSM.
MAX_CHARS = 240
BATCH = 20  # the MediaWiki API's limit for extracts per query
# The shorter of a name and a title must be this long (normalised) to count
# as contained, whole words only. "stuhr museum" (12) inside "stuhr museum of
# the prairie pioneer" passes. A short generic title such as "Prison" (6) or
# "Museum" (6) inside a long name fails, since that article is about the kind
# of place, not this one. The same 8 osm_ground.py uses. Raising it loses
# shortened titles; lowering it lets one-word generic articles through.
MIN_CONTAINED_CHARS = 8
# A trim that leaves fewer characters than this keeps the whole sentence
# instead. Operator's choice, 2026-11-10: "Howard Payne University is a
# private university in Brownwood, Texas, United States." trims to "A private
# university." (21), which says less than the sentence it came from. The four
# other U48 sentences trim to 37 or more. Raising it past 37 stops Fonner
# Park's trim; lowering it below 21 lets Howard Payne's through.
MIN_TRIMMED_CHARS = 25
USER_AGENT = "city-atlas-service/0.1 (+https://github.com/Anguijm/city-atlas-service; ops@anguijm.dev)"

Fetch = Callable[[dict], dict]


def wants_description(w: object) -> bool:
    if not isinstance(w, dict):
        return False
    d = w.get("description")
    text = (d.get("en") or "") if isinstance(d, dict) else (d or "")
    return not text.strip() or w.get("description_source") == "osm"


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("&", " and ")
    s = re.sub(r"\s*\(.*\)$", "", s)  # "Blue Hole (New Mexico)"
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"^the ", "", s)


def same_subject(name: str, title: str) -> bool:
    a, b = _norm(name), _norm(title)
    if a == b:
        return True
    short, long_ = sorted((a, b), key=len)
    return len(short) >= MIN_CONTAINED_CHARS and re.search(rf"\b{re.escape(short)}\b", long_) is not None


def _name(w: dict) -> str:
    n = w.get("name")
    return ((n.get("en") or "") if isinstance(n, dict) else (n or "")).strip()


def trim_lead(text: str, name: str, title: str, place: str = "") -> str:
    """Wikipedia's sentence without what the screen already says: the
    place's own name as the subject ("Fonner Park is a ...") and the town
    ("located in Grand Island, Nebraska"). `place` is the town as the
    registry's clinicalName gives it ("Grand Island, Nebraska"); another town
    of the same name elsewhere does not match it. Deletes words only. A
    result under MIN_TRIMMED_CHARS returns the sentence unchanged."""
    out = text
    name, title, place = (name or "").strip(), (title or "").strip(), (place or "").strip()
    # "The Reliance Tipple is the site ..." -> "The site ...": the subject is
    # the name or the article title, the verb is "is" or "are", and the
    # article that follows is kept, capitalised, to start the line. Never
    # "was"/"were": "X was a casino" says it is gone, and "A casino" would
    # say it is open (PR #64 council).
    names = "|".join(re.escape(n) for n in sorted({name, title} - {""}, key=len, reverse=True))
    if names:
        m = re.match(rf"(?:the\s+)?(?:{names})\s+(?:is|are)\s+(a|an|the)\s+", out, flags=re.IGNORECASE)
        if m:
            # group(1) is the article ("a", "an", "the"); it becomes the
            # line's first word, so it is capitalised and the rest follows.
            out = m.group(1).capitalize() + " " + out[m.end():]
    # ", located in Grand Island, Nebraska" or " in West Wendover, Nevada",
    # with an optional ", United States". It must end at a space, a full
    # stop or other punctuation, or a comma NOT followed by a capitalised
    # word: a clinicalName without its state ("Grand Island") would
    # otherwise leave "A facility, Nebraska." behind (PR #64 council).
    if place:
        m = re.search(rf",?\s+(?:located\s+)?in\s+{re.escape(place)}(?:,\s+United States)?(?=[\s.;:]|,(?!\s+[A-Z])|$)", out)
        # Not when the clause is the sentence's predicate: "X is located in
        # Grand Island, Nebraska." would become "X is." (PR #64 council).
        if m and not re.search(r"\b(?:is|are|was|were)$", out[:m.start()].rstrip(), flags=re.IGNORECASE):
            out = out[:m.start()] + out[m.end():]
    return out if len(out) >= MIN_TRIMMED_CHARS else text


def lookup(names: list[str], fetch: Fetch) -> dict[str, dict]:
    """name -> {"title", "lat", "lng", "extract"} for names with a usable article."""
    found: dict[str, dict] = {}
    # "|" separates titles in the API; a name holding one cannot be asked.
    names = [n for n in names if "|" not in n]
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
            for _ in range(3):  # normalised, then redirected, then once more for a chain
                title = hops.get(title, title)
            if not same_subject(name, title):
                continue
            p = pages.get(title)
            if not p or "missing" in p or "disambiguation" in p.get("pageprops", {}):
                continue
            co = (p.get("coordinates") or [None])[0]
            extract = (p.get("extract") or "").strip()
            if co and extract:
                found[name] = {"title": title, "lat": co["lat"], "lng": co["lon"], "extract": extract}
    return found


def describe_from_wikipedia(waypoints: list, town_lat: float, town_lng: float, fetch: Fetch, place: str = "") -> list[tuple[str, str]]:
    """Mutates waypoints; returns (place name, article title) for each described.
    `place` is the town's clinicalName, for trim_lead; without it only the
    name is trimmed."""
    wanted = [w for w in waypoints if wants_description(w) and _name(w)]
    if not wanted:
        return []
    found = lookup(sorted({_name(w) for w in wanted}), fetch)
    described = []
    for w in wanted:
        hit = found.get(_name(w))
        if not hit:
            continue
        # MAX_CHARS bounds what is shown, so it is checked after the trim.
        line = trim_lead(hit["extract"], _name(w), hit["title"], place)
        if len(line) > MAX_CHARS:
            continue
        if haversine_km(town_lat, town_lng, hit["lat"], hit["lng"]) > MAX_KM:
            continue
        w["description"] = {"en": line}
        w["description_source"] = "wikipedia"
        described.append((_name(w), hit["title"]))
    return described


def http_fetch(params: dict) -> dict:
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt * 2)
    raise AssertionError("unreachable")
