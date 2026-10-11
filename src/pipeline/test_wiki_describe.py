from wiki_describe import MAX_CHARS, describe_from_wikipedia, lookup, wants_description

RAWLINS = (41.7911, -107.2387)

PRISON = "The Wyoming State Penitentiary is an American historic and current prison in Rawlins."


def api(pages, redirects=(), normalized=()):
    calls = []

    def fetch(params):
        calls.append(params)
        return {"query": {
            "redirects": [{"from": a, "to": b} for a, b in redirects],
            "normalized": [{"from": a, "to": b} for a, b in normalized],
            "pages": {str(i): p for i, p in enumerate(pages)},
        }}
    fetch.calls = calls
    return fetch


def page(title, lat=41.77, lng=-107.22, extract=PRISON, **extra):
    return {"title": title, "coordinates": [{"lat": lat, "lon": lng}], "extract": extract, **extra}


def wp(name, description=None, source=None):
    w = {"id": name.lower(), "name": {"en": name}}
    if description is not None:
        w["description"] = {"en": description}
    if source:
        w["description_source"] = source
    return w


def test_only_listing_or_missing_descriptions_are_wanted():
    assert wants_description(wp("A"))
    assert wants_description(wp("A", "Museum on US-34.", "osm"))
    assert not wants_description(wp("A", "From Atlas Obscura."))


def test_follows_a_redirect_to_the_same_subject_and_describes_the_place():
    museum = "The Stuhr Museum of the Prairie Pioneer is a museum located in Grand Island."
    fetch = api([page("Stuhr Museum", extract=museum)], redirects=[("Stuhr Museum of the Prairie Pioneer", "Stuhr Museum")])
    ws = [wp("Stuhr Museum of the Prairie Pioneer")]
    assert describe_from_wikipedia(ws, *RAWLINS, fetch) == [("Stuhr Museum of the Prairie Pioneer", "Stuhr Museum")]
    assert ws[0]["description"] == {"en": museum}
    assert ws[0]["description_source"] == "wikipedia"


def test_refuses_a_redirect_to_a_broader_subject():
    # U48 critic: "historic and current prison" read as a working prison.
    fetch = api([page("Wyoming State Penitentiary")], redirects=[("Wyoming Frontier Prison", "Wyoming State Penitentiary")])
    ws = [wp("Wyoming Frontier Prison")]
    assert describe_from_wikipedia(ws, *RAWLINS, fetch) == []
    assert "description" not in ws[0]


def test_an_empty_description_is_wanted_and_a_name_with_a_pipe_is_not_asked():
    assert wants_description(wp("A", ""))
    assert wants_description(wp("A", "   "))
    fetch = api([])
    lookup(["Bar | Grill", "Fonner Park"], fetch)
    assert fetch.calls[0]["titles"] == "Fonner Park"


def test_never_replaces_another_sources_description():
    fetch = api([page("Carbon County Museum")])
    ws = [wp("Carbon County Museum", "Gemini, grounded on Wikipedia.")]
    assert describe_from_wikipedia(ws, *RAWLINS, fetch) == []
    assert fetch.calls == []


def test_rejects_far_articles_disambiguation_missing_and_long_sentences():
    fetch = api([
        page("Far Museum", lat=40.0),
        page("Same Name", pageprops={"disambiguation": ""}),
        {"title": "Gone", "missing": ""},
        page("Wordy", extract="x" * (MAX_CHARS + 1)),
        page("Exactly", extract="y" * MAX_CHARS),
    ])
    ws = [wp(n, "Listing.", "osm") for n in ["Far Museum", "Same Name", "Gone", "Wordy", "Exactly"]]
    assert [n for n, _ in describe_from_wikipedia(ws, *RAWLINS, fetch)] == ["Exactly"]
    assert ws[0]["description"] == {"en": "Listing."}


def test_follows_normalisation_then_redirect():
    fetch = api([page("Stuhr Museum", lat=40.88, lng=-98.37)],
                normalized=[("stuhr Museum of the Prairie Pioneer", "Stuhr Museum of the Prairie Pioneer")],
                redirects=[("Stuhr Museum of the Prairie Pioneer", "Stuhr Museum")])
    found = lookup(["stuhr Museum of the Prairie Pioneer"], fetch)
    assert found["stuhr Museum of the Prairie Pioneer"]["title"] == "Stuhr Museum"


def test_asks_in_batches_of_twenty():
    fetch = api([])
    lookup([f"Place {i}" for i in range(45)], fetch)
    assert [len(c["titles"].split("|")) for c in fetch.calls] == [20, 20, 5]
