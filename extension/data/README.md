# Baseline syllabus dataset

`baseline-syllabi.json` ships inside the extension and is loaded once by the
background service worker (`background.js`) as a starting data source for
the Likeness Score, on top of whatever a given user has uploaded themselves
via the Options page. It exists so the score isn't cold-start-empty for
professors nobody local has fed data for yet.

## Format

```json
{
  "<normalized professor key>": [
    {
      "courseCode": "COEN 280",
      "term": "Fall 2020",
      "fileName": "Syllabus280.pdf",
      "sourceUrl": "https://www.cse.scu.edu/~m1wang/database/Syllabus280.pdf",
      "analyzedScore": 62
    }
  ]
}
```

- The key is `lib/rmp.js`'s `normalizeName()` output (lowercased, punctuation
  stripped, tokens sorted) — the same key everything else (RMP cache,
  user-uploaded syllabi, course evals) is filed under, so a professor's
  score merges signal regardless of source or which name-format detected it.
- `analyzedScore` is `Scoring.analyzeSyllabusText()`'s 0-100 output — do not
  hand-pick this number; regenerate it by running the syllabus text through
  that function so it stays consistent with what a live upload would produce.
- `sourceUrl` should always point at a publicly reachable page — this file
  is meant for material anyone could already find themselves (a professor's
  own department page, a public course site), not anything gated behind a
  login.

## Regenerating

Use `tools/ingest-syllabi.js` (see `tools/README.md`) rather than editing
this file by hand — it does the text extraction and scoring consistently
and merges into the existing file instead of clobbering it.
