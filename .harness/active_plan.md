# Active plan: trim Wikipedia lines of what the screen already shows (U49)

Branch: `feat/trim-wiki-lines`

**Ship rule:** A Wikipedia sentence loses its own subject ("Fonner Park is a")
and its town ("located in Grand Island, Nebraska", matched to the registry's
clinicalName), because Roadtripper prints the name above the line and the
town above both. Words are only deleted, never rewritten. A trim that leaves
fewer than 25 characters keeps the whole sentence (operator's choice,
2026-11-10: Howard Payne University keeps its line). On the live atlas
exactly four lines change: Fonner Park, Stuhr Museum, Reliance Tipple,
Wendover Will.

**What changes**
- `wiki_describe.py`: `trim_lead()` and `MIN_TRIMMED_CHARS`;
  `describe_from_wikipedia` writes the trimmed line and checks `MAX_CHARS`
  on it; `research_city.py` passes the town's clinicalName.
- `scripts/one-off/trim_wiki_lines_2026_11_10.py`: the same trim on the five
  sentences already in Firestore (the saved JSON is on the laptop, untracked).
  Dry run by default; only `description.en`, both copies.

**Proof:** tests for the five real sentences, Howard Payne's floor, title
matching and a same-named town elsewhere. Mutation proofs: removing the town
trim fails 3 tests, removing the floor 1, unwiring the trim 2. Dry run on the
live atlas lists exactly the four lines.

**Cost:** None at run time. Four Firestore updates, two documents each.

**Weakest part:** The town match is literal. A sentence saying "in Grand
Island, Hall County, Nebraska" keeps its town; only a shorter line is lost.
