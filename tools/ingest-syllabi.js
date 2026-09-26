#!/usr/bin/env node
// Batch-processes a folder of syllabus PDFs into extension/data/baseline-syllabi.json.
// Usage: node ingest-syllabi.js <folder-of-pdfs>
//
// Auto-detects professor name, course code, and term from each PDF's text.
// When detection is unreliable, drop a manifest.json in the same folder:
//   { "some-file.pdf": { "professor": "Jane Smith", "courseCode": "COEN 280",
//                         "term": "Fall 2020", "sourceUrl": "https://..." } }
// Manifest entries override auto-detection field by field.
//
// Only feed this PDFs that are legitimately public (a professor's own
// department page, a public course site) — see extension/data/README.md.

const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const { normalizeName } = require('../extension/lib/rmp.js');
const Scoring = require('../extension/lib/scoring.js');
const Detect = require('../extension/lib/detect.js');

async function extractText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += Detect.textFromPdfContent(content.items);
  }
  return text;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node ingest-syllabi.js <folder-of-pdfs>');
    process.exit(1);
  }

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : {};

  const outPath = path.join(__dirname, '..', 'extension', 'data', 'baseline-syllabi.json');
  const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};

  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (files.length === 0) {
    console.error(`No PDFs found in ${dir}`);
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;

  for (const fileName of files) {
    const filePath = path.join(dir, fileName);
    const overrides = manifest[fileName] || {};
    process.stdout.write(`Processing ${fileName}... `);

    let text;
    try {
      text = await extractText(filePath);
    } catch (err) {
      console.log(`FAILED to read PDF (${err.message})`);
      skipped++;
      continue;
    }

    const professor = overrides.professor || Detect.professor(text, fileName);
    const courseCode = overrides.courseCode || Detect.courseCode(text);
    const term = overrides.term || Detect.term(text);
    const analyzedScore = Scoring.analyzeSyllabusText(text);

    if (!professor) {
      console.log('SKIPPED — could not determine professor (add it to manifest.json)');
      skipped++;
      continue;
    }

    const key = normalizeName(professor);
    existing[key] = existing[key] || [];
    // Replace a prior entry for the same file rather than duplicating it.
    existing[key] = existing[key].filter((e) => e.fileName !== fileName);
    existing[key].push({
      courseCode: courseCode || null,
      term: term || null,
      fileName,
      sourceUrl: overrides.sourceUrl || null,
      analyzedScore,
    });

    console.log(`OK — ${professor} / ${courseCode || '?'} / ${term || '?'} → score ${analyzedScore}`);
    imported++;
  }

  const sorted = Object.keys(existing).sort().reduce((acc, k) => {
    acc[k] = existing[k];
    return acc;
  }, {});
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n');

  console.log(`\nImported ${imported}, skipped ${skipped}. Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
