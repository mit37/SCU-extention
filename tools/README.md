# Maintainer tools

Scripts here build `extension/data/baseline-syllabi.json`, the starter
dataset shipped with the extension. They are **not** part of the extension
itself — nothing here is loaded by `manifest.json`.

## Setup

```
cd tools
npm install
```

## Ingesting a batch of syllabus PDFs

```
node ingest-syllabi.js /path/to/folder-of-pdfs
```

For each `.pdf` in the folder, it:
1. Extracts text with `pdfjs-dist`.
2. Guesses the professor's name (an "Instructor:" line, falling back to
   capitalized words in the filename), the course code, and the term.
3. Scores the syllabus text with the same `Scoring.analyzeSyllabusText()`
   the extension itself uses, so results are consistent with a live upload.
4. Merges the result into `extension/data/baseline-syllabi.json`, keyed by
   the professor's normalized name (matching `lib/rmp.js`'s `normalizeName`)
   so it lines up with RMP cache entries, user-uploaded syllabi, and course
   evals for the same person.

Auto-detection is a best guess — when a syllabus doesn't have a clean
"Instructor:" line, or the course-code/term regexes miss, add a
`manifest.json` next to the PDFs to override specific fields per file:

```json
{
  "some-syllabus.pdf": {
    "professor": "Jane Smith",
    "courseCode": "COEN 280",
    "term": "Fall 2020",
    "sourceUrl": "https://example.scu.edu/~jsmith/syllabus.pdf"
  }
}
```

Re-running the script is safe — it replaces any prior entry for the same
filename instead of duplicating it, and leaves every other professor's
entries untouched.

## Only public material

Only run this against syllabi anyone could already find themselves (a
professor's own page, a department's public course site) — not anything
pulled from behind a Canvas/Workday login. `sourceUrl` should always be a
link you could hand someone with no SCU credentials and have it load.
