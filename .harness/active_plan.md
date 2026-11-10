# Active plan: Toledo, Ohio joins the atlas

Branch: `feat/toledo-oh`

**Ship rule:** Toledo is in the registry (`toledo-oh`, metro, 20 km like
Lincoln) and in the live `urbanexplorer` atlas with places that pass Phase C,
so Roadtripper can stop there on I-75 between Ann Arbor and Dayton. Found by
the roadtripper-car session on 2026-11-10 (a Detroit to Ohio drive had no town
for 300 km); John picked it the same day. Same path as the October corridor
towns (#61, #62): scrape every source, then `research_city.py --mode gemini
--ingest`, with OSM grounding.

**Proof:** the registry still parses with unique ids; Phase C passes; the
ingest's own counts, then a read back from Firestore of the city document and
its waypoints; then Roadtripper's atlas export shows the city.

**Cost:** About four Gemini 2.5 Pro calls on the pipeline key (a few cents).
Firestore writes for one city. No Places calls (ingest runs with
`--skip-validation`, as in October).

**Weakest part:** Gemini writes the place descriptions. OSM grounding checks
names and positions, not the sentences, so a wrong detail in a description
can still get through. Spot-read them before merging.
