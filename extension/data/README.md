# Baseline syllabus dataset

`baseline-syllabi.json` ships inside the extension and is loaded by the
background service worker as a starting data source for each professor's
syllabus difficulty rating and Likeness Score, merged with whatever a user
has uploaded themselves. It exists so scores aren't cold-start-empty.

## Format

```json
{
  "<normalized professor key>": [
    {
      "professor": "Ming-Hwa Wang",
      "courseCode": "COEN 280",
      "courseTitle": "Database Systems",
      "term": "Fall 2020",
      "fileName": "3f2a9c1b7e-syllabus280.pdf",
      "sourceUrl": "https://www.cse.scu.edu/~m1wang/database/Syllabus280.pdf",
      "professorCurrentlyAtScu": "yes",
      "fairnessScore": 34,
      "difficultyScore": 82,
      "signals": [{ "label": "cumulative final", "difficulty": 6 }]
    }
  ]
}
```

- The key is `lib/rmp.js`'s `normalizeName()` output (lowercased, titles and
  initials dropped, tokens sorted), the same key RMP cache entries, user
  uploads, and course evals are filed under.
- `fairnessScore`, `difficultyScore`, and `signals` come from
  `Scoring.analyzeSyllabus()`. Never hand-edit them; regenerate by
  re-running the ingest so they stay consistent with live uploads.
- `sourceUrl` must be publicly reachable — a professor's own page or a
  department's public course site, never anything behind a login, and never
  third-party homework-sharing sites.

## Regenerating

From `tools/`: `npm install && npm run build-baseline`. See `tools/README.md`.
