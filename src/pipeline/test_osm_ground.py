from osm_ground import ground_waypoints, norm, osm_match, parse_osm_markdown

MD = """# OpenStreetMap: Grand Island

Named places …

- **Stuhr Museum of the Prairie Pioneer** — museum — 3133 US-34 — 40.88164, -98.37326 — https://stuhrmuseum.org/
- **Wave Pizza** — restaurant — 40.92313, -98.34212
- **Baribal Coffee** — cafe — 314 North Walnut Street — 40.92499, -98.34402
- **Bar** — bar — 40.90000, -98.30000
- **Subway** — restaurant — 40.95000, -98.40000
- **Subway** — restaurant — 40.88000, -98.33000
"""
PLACES = parse_osm_markdown(MD)


def wp(name, lat=40.9, lng=-98.3):
    return {"id": norm(name), "name": {"en": name}, "lat": lat, "lng": lng}


def test_parse_reads_name_and_position_past_the_address():
    assert PLACES[0] == {"name": "Stuhr Museum of the Prairie Pioneer", "lat": 40.88164, "lng": -98.37326,
                         "kind": "museum", "address": "3133 US-34"}
    assert PLACES[1]["address"] == ""
    assert len(PLACES) == 6


def test_norm_ignores_case_punctuation_and_a_leading_the():
    assert norm("The Chocolate Bar") == norm("chocolate bar")
    assert norm("Images Bar & Grill") == "images bar and grill"


def test_contained_name_matches_but_a_short_word_does_not():
    assert osm_match(wp("Wave Pizza Company"), PLACES)["name"] == "Wave Pizza"
    assert osm_match(wp("Balz Sports Bar"), PLACES) is None


def test_a_chain_matches_the_nearest_branch():
    assert osm_match(wp("Subway", 40.881, -98.331), PLACES)["lat"] == 40.88


def test_ground_snaps_confirms_keeps_sourced_and_drops_invented():
    ws = [wp("Stuhr Museum of the Prairie Pioneer", 40.0, -98.0), wp("Stolley Park"), wp("The 'Hidden' Walkways")]
    kept, confirmed, dropped = ground_waypoints(ws, PLACES, MD, "The most prominent include Stolley Park.")
    assert [w["name"]["en"] for w in kept] == ["Stuhr Museum of the Prairie Pioneer", "Stolley Park"]
    assert kept[0]["lat"] == 40.88164
    assert confirmed == {"stuhr museum of the prairie pioneer"}
    assert dropped == ["The 'Hidden' Walkways"]


def test_a_source_word_inside_another_word_does_not_ground_a_name():
    _, _, dropped = ground_waypoints([wp("Rail")], [], "", "the railroad town")
    assert dropped == ["Rail"]


def test_a_place_only_osm_knows_gets_the_listing_as_its_description():
    ws = [dict(wp("Baribal Coffee"), description={"en": "Single-origin beans, precisely pulled."}),
          dict(wp("Wave Pizza Company"), description={"en": "Piled-high pizzas."}),
          dict(wp("Stuhr Museum of the Prairie Pioneer"), description={"en": "Railroad Town, rebuilt."})]
    kept, _, _ = ground_waypoints(ws, PLACES, MD, "Visit the Stuhr Museum of the Prairie Pioneer.")
    assert [w.get("description", {}).get("en") for w in kept] == [
        "Cafe on North Walnut Street.",
        None,
        "Railroad Town, rebuilt.",
    ]


def test_a_confirmed_place_takes_the_mapped_spelling():
    kept, confirmed, _ = ground_waypoints([wp("Wave Pizza Company")], PLACES, MD, "")
    assert kept[0]["name"] == {"en": "Wave Pizza"}
    assert confirmed == {"wave pizza"}


def test_another_source_naming_either_spelling_keeps_the_description():
    places = [{"name": "Stuhr Museum of the Prairie Pioneer", "lat": 40.88, "lng": -98.37, "kind": "museum", "address": ""},
              {"name": "Wave Pizza", "lat": 40.92, "lng": -98.34, "kind": "restaurant", "address": ""}]
    ws = [dict(wp("Stuhr Museum"), description={"en": "Railroad Town."}),
          dict(wp("Wave Pizza Company"), description={"en": "Downtown pizza."})]
    kept, _, _ = ground_waypoints(ws, places, "", "The Stuhr Museum is out west; Wave Pizza downtown.")
    assert [w["description"]["en"] for w in kept] == ["Railroad Town.", "Downtown pizza."]
