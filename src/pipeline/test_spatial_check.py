from spatial_check import far_places, limit_km

ABILENE = {"id": "sweetwater-tx", "name": "Sweetwater", "lat": 32.471, "lng": -100.4059, "maxRadiusKm": 3}


def test_rejects_the_miami_sweetwater():
    miami = [{"id": "quesillos", "lat": 25.7613, "lng": -80.3775}]
    errs = far_places(ABILENE, miami, "Waypoint")
    assert len(errs) == 1 and "2080 km" in errs[0]


def test_keeps_places_in_town_and_its_outskirts():
    near = [{"id": "a", "lat": 32.47, "lng": -100.40}, {"id": "b", "lat": 32.65, "lng": -100.40}]  # 0 and ~20 km
    assert far_places(ABILENE, near, "Waypoint") == []


def test_limit_is_three_radii_but_never_under_30_km():
    assert limit_km({"maxRadiusKm": 3}) == 30
    assert limit_km({"maxRadiusKm": 25}) == 75


def test_skips_items_without_coordinates_and_cities_without_a_point():
    assert far_places(ABILENE, [{"id": "x"}, "junk"], "Waypoint") == []
    assert far_places({"id": "nowhere"}, [{"lat": 0.0, "lng": 0.0}], "Waypoint") == []
