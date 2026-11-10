# Active plan: approved plain-word place lines (U51)

Branch: `feat/description-overrides`

**Ship rule:** A place line John approved, kept in
`data/description-overrides.json` with its source and approval, wins over
every pipeline source at `writeCityToFirestore`, the one place every ingest
writes through, so a later run cannot put the old wording back.
`scripts/apply_description_overrides.py` writes them to the live atlas now
(dry run by default). Five lines, all facts from each place's Wikipedia
article, approved by John 2026-11-10: Stuhr Museum, Fonner Park, Wendover
Will, Reliance Tipple, Howard Payne University.

**Proof:** tests for the file (sourced, approved, at most 240 characters),
the pure apply, a malformed or over-long entry failing loudly, and the
writer writing the override in both copies. Mutation proof: removing the
hook in `writeCityToFirestore` turns the writer test red. Dry run on the
live atlas: exactly the five lines.

**Also fixed:** the Firestore writer's tests mocked `FieldValue` without
`delete`, which #63 started using, so seven tests failed on main, unseen
because CI's validate job stops at its npm audit step first. Four other
tests (index definitions, coverage tiers) fail on main and here alike;
recorded, not touched.

**Cost:** None at run time. Five Firestore updates, two documents each.

**Weakest part:** The rewrites are no longer the source's own sentences, so
their accuracy rests on the drafting and John's approval; each cites its
article so it can be checked.
