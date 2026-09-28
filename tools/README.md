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

1. **`public-syllabi-sources.json`** lists 147 publicly hosted SCU syllabi
   (scu.edu faculty/department pages and a few instructor-owned course sites)
   across 24 subject prefixes, discovered by a web-search sweep in Sept 2026.
   Every URL was confirmed to appear verbatim in a real search result;
   professor/term fields were kept only where the search evidence supports
   them. Homework-sharing sites (Course Hero, Studocu, Quizlet, Chegg, …) are
   excluded by policy; the four other exclusions are listed with reasons in
   the file itself.
2. **`fetch-syllabi.js`** downloads each URL into `downloads/` (gitignored):
   one request at a time with a 1s pause, a descriptive User-Agent, retries on
   5xx/429, and byte-level checks that a "PDF"/".docx" really is one (catches
   login-wall pages served in their place). Files already downloaded are
   skipped on re-runs. It writes `downloads/manifest.json` (metadata per file)
   and `downloads/fetch-report.json` (what failed and why).
3. **`ingest-syllabi.js <folder> [--out <path>]`** extracts text from each
   `.pdf`/`.html`/`.xml`/`.docx`, skips pages that don't read like a syllabus
   and byte-identical copies hosted at a second URL, runs
   `Scoring.analyzeSyllabus()` for a 0–100 difficulty and fairness score plus
   human-readable reasons, and merges the result into the baseline file,
   keyed by normalized professor name. For search-sourced entries the
   document's own "Instructor:" line wins over the search hint (disagreements
   are printed as `NOTE`); a hand-written `manifest.json` wins over the
   document. Re-running is idempotent.

Run it anywhere that can reach scu.edu — e.g. your own laptop — then commit
the updated `extension/data/baseline-syllabi.json`.

Behind a corporate/sandbox proxy, Node's `fetch` ignores `HTTPS_PROXY` unless
you run with `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21).

## Adding your own files

Drop PDF/HTML/DOCX files into any folder and run `node ingest-syllabi.js <folder>`.
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
