# Maintainer tools

Scripts that build `extension/data/baseline-syllabi.json`, the starter
dataset shipped with the extension. Nothing here is loaded by the extension.

```
cd tools
npm install
npm run build-baseline   # fetch every public syllabus, then score them
npm test                 # unit + end-to-end tests
```

## Pipeline

1. **`public-syllabi-sources.json`** lists publicly hosted SCU syllabi (scu.edu
   faculty/department pages, or instructor-owned course sites) with verified
   professor, course, and term. It was assembled from web-search results and
   each URL was checked to actually appear in search results. Homework-sharing
   sites (Course Hero, Studocu, Quizlet, Chegg, …) are deliberately excluded.
2. **`fetch-syllabi.js`** downloads each URL into `downloads/` (gitignored):
   one request at a time with a 1s pause, a descriptive User-Agent, retries on
   5xx/429, and a check that a "PDF" really is a PDF (catches login-wall
   redirects). Files already downloaded are skipped on re-runs. It writes
   `downloads/manifest.json` (the verified metadata per file) and
   `downloads/fetch-report.json` (what failed and why).
3. **`ingest-syllabi.js <folder> [--out <path>]`** extracts text from each
   `.pdf`/`.html`, runs `Scoring.analyzeSyllabus()` for a 0–100 difficulty and
   fairness score plus human-readable reasons, and merges the result into the
   baseline file, keyed by normalized professor name. Metadata from
   `manifest.json` wins over auto-detection. Re-running is idempotent.

Behind a corporate/sandbox proxy, Node's `fetch` ignores `HTTPS_PROXY` unless
you run with `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21).

## Adding your own files

Drop PDFs/HTML into any folder and run `node ingest-syllabi.js <folder>`.
Professor/course/term are auto-detected (an "Instructor:" line, an SCU course
prefix like `COEN 280`, a "Fall 2024" style term). When detection misses, add a
`manifest.json` next to the files:

```json
{ "some-syllabus.pdf": { "professor": "Jane Smith", "courseCode": "COEN 280", "term": "Fall 2020", "sourceUrl": "https://…" } }
```

Only use syllabi that are legitimately public — anyone without an SCU login
should be able to open `sourceUrl`.

## How difficulty is scored

`Scoring.analyzeSyllabus()` in `extension/lib/scoring.js` starts at 50 and
adds or subtracts for each signal it finds, each with a label shown to users:
number of midterms/exams, share of the grade from exams, cumulative final,
weekly quizzes/homework, major projects and long papers (harder); no final,
curved grading, dropped lowest score, extra credit, late-work grace, open
book, resubmissions (easier). Negations are handled ("not curved" ≠ "curved").
It's a transparent heuristic, not a model — the unit tests in `test/` pin down
its behavior, and it should be re-tuned as real syllabi come in.
