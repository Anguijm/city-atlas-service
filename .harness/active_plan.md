# Active plan: Toledo's Cloister gets a plain-word line

Branch: `feat/cloister-line`

**Ship rule:** Toledo's Cloister read "Museum on Monroe Street.", the
OpenStreetMap listing's line, because the grounding matched it to the
museum's own map entry. John approved (2026-11-10) "A courtyard framed by
centuries-old columns from French monasteries.", every fact from the Atlas
Obscura listing saved at `data/atlas-obscura/toledo-oh.md` (Wikipedia's
museum article does not mention the Cloister). It goes in
`data/description-overrides.json`, the U51 file that wins at every ingest,
and `scripts/apply_description_overrides.py --apply` writes it to the live
atlas after merge.

**Proof:** the file's test pins the line and now allows a source the
pipeline scrapes and keeps (`wikipedia:` or `atlas-obscura:`). Mutation
proof: a `gemini:` source turns it red. Dry run on the live atlas: exactly
this one line would change; the U51 five read "same".

**Cost:** None. Two Firestore document updates.

**Weakest part:** the line paraphrases a short listing, so it says only
what Atlas Obscura's one sentence says: no dates, no names of the
monasteries.
