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
    # The lead-in is trimmed (U49); no place given, so the town stays.
    assert ws[0]["description"] == {"en": "A museum located in Grand Island."}
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


# U49: trim what the screen already shows. Roadtripper prints the place's
# name above its line and the town above both, so "Fonner Park is a ...
# located in Grand Island, Nebraska." says two of its three things twice.
# The trim only deletes words; it never rewrites the sentence.

from wiki_describe import MIN_TRIMMED_CHARS, trim_lead  # noqa: E402

GI = "Grand Island, Nebraska"


def test_trims_the_name_and_the_town_from_the_five_u48_sentences():
    cases = [
        ("Stuhr Museum of the Prairie Pioneer", GI,
         "The Stuhr Museum of the Prairie Pioneer is a museum located in Grand Island, Nebraska intended to preserve the legacy of the Pioneers who settled the plains of Central Nebraska in the late 19th century.",
         "A museum intended to preserve the legacy of the Pioneers who settled the plains of Central Nebraska in the late 19th century."),
        ("Fonner Park", GI,
         "Fonner Park is a thoroughbred horse racing facility located in Grand Island, Nebraska.",
         "A thoroughbred horse racing facility."),
        ("Wendover Will", "West Wendover, Nevada",
         "Wendover Will is a sign created for the Stateline Casino in West Wendover, Nevada in 1952.",
         "A sign created for the Stateline Casino in 1952."),
        # Reliance is another place, not the town on screen: it stays.
        ("Reliance Tipple", "Rock Springs, Wyoming",
         "The Reliance Tipple is the site of two coal tipples associated with coal production at Reliance, Wyoming.",
         "The site of two coal tipples associated with coal production at Reliance, Wyoming."),
    ]
    for name, place, before, after in cases:
        assert trim_lead(before, name, name, place) == after


def test_keeps_the_whole_sentence_when_the_trim_leaves_too_little():
    # Operator's choice, 2026-11-10: "A private university." (21) says less
    # than the sentence it came from; keep the original instead.
    s = "Howard Payne University is a private university in Brownwood, Texas, United States."
    assert len("A private university.") < MIN_TRIMMED_CHARS
    assert trim_lead(s, "Howard Payne University", "Howard Payne University", "Brownwood, Texas") == s


def test_trims_by_the_article_title_and_leaves_other_sentences_alone():
    s = "Stuhr Museum is a museum of the plains pioneers and their railroad town."
    assert trim_lead(s, "Stuhr Museum of the Prairie Pioneer", "Stuhr Museum", GI) == "A museum of the plains pioneers and their railroad town."
    # No lead-in, no town: nothing to delete.
    plain = "A living history museum with an 1890s railroad town on its grounds."
    assert trim_lead(plain, "Stuhr Museum", "Stuhr Museum", GI) == plain
    # Another town of the same name elsewhere is not the one on screen.
    other = "Fonner Park is a thoroughbred horse racing facility located in Grand Island, New York."
    assert trim_lead(other, "Fonner Park", "Fonner Park", GI) == "A thoroughbred horse racing facility located in Grand Island, New York."


def test_describe_from_wikipedia_writes_the_trimmed_line():
    fonner = "Fonner Park is a thoroughbred horse racing facility located in Grand Island, Nebraska."
    fetch = api([page("Fonner Park", lat=40.90, lng=-98.33, extract=fonner)])
    ws = [wp("Fonner Park", "Racetrack on Fonner Park Road.", "osm")]
    assert describe_from_wikipedia(ws, 40.9264, -98.342, fetch, place=GI) == [("Fonner Park", "Fonner Park")]
    assert ws[0]["description"] == {"en": "A thoroughbred horse racing facility."}


def test_council_64_edge_cases_leave_the_sentence_whole_or_grammatical():
    # The clause is the predicate: deleting it would leave "... is."
    s = "The Stuhr Museum of the Prairie Pioneer is located in Grand Island, Nebraska."
    assert trim_lead(s, "Stuhr Museum of the Prairie Pioneer", "Stuhr Museum", GI) == s
    # Past tense says the place is gone; "A casino ..." would say it is open.
    gone = "Stateline Casino was a casino and hotel in West Wendover, Nevada until 1993."
    assert trim_lead(gone, "Stateline Casino", "Stateline Casino", "West Wendover, Nevada").startswith("Stateline Casino was a casino")
    # A town given without its state leaves no dangling ", Nebraska".
    fonner = "Fonner Park is a thoroughbred horse racing facility located in Grand Island, Nebraska."
    assert trim_lead(fonner, "Fonner Park", "Fonner Park", "Grand Island") == "A thoroughbred horse racing facility located in Grand Island, Nebraska."
    # A missing name, title or town is not a crash.
    assert trim_lead(fonner, None, None, None) == fonner
