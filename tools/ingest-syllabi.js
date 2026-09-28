#!/usr/bin/env node
// Turns a folder of syllabus files (.pdf, .html, .htm) into entries in
// extension/data/baseline-syllabi.json.
//
// Usage: node ingest-syllabi.js <folder> [--out <path>]
//
// Professor, course code, and term are auto-detected from each file's text.
// A manifest.json in the same folder overrides detection per file — this is
// what fetch-syllabi.js writes, carrying the verified metadata from
// public-syllabi-sources.json:
//   { "file.pdf": { "professor": "Jane Smith", "courseCode": "COEN 280",
//                   "term": "Fall 2020", "sourceUrl": "https://..." } }
//
// Only feed this publicly reachable syllabi — see extension/data/README.md.

const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const { normalizeName } = require('../extension/lib/rmp.js');
const Scoring = require('../extension/lib/scoring.js');
const Detect = require('../extension/lib/detect.js');

const STANDARD_FONTS = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
const SUPPORTED = /\.(pdf|html?)$/i;

async function pdfText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({
    data,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += Detect.textFromPdfContent(content.items);
  }
  return text;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function extractText(filePath) {
  if (/\.pdf$/i.test(filePath)) return pdfText(filePath);
  return htmlToText(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const args = { dir: null, out: path.join(__dirname, '..', 'extension', 'data', 'baseline-syllabi.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (!args.dir) args.dir = argv[i];
  }
  return args;
}

async function main() {
  const { dir, out } = parseArgs(process.argv.slice(2));
  if (!dir) {
    console.error('Usage: node ingest-syllabi.js <folder> [--out <path>]');
    process.exit(1);
  }

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const existing = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};

  const files = fs.readdirSync(dir).filter((f) => SUPPORTED.test(f)).sort();
  if (files.length === 0) {
    console.error(`No .pdf/.html files found in ${dir}`);
    process.exit(1);
  }

  let imported = 0;
  const skipped = [];

  for (const fileName of files) {
    const overrides = manifest[fileName] || {};
    const identity = overrides.sourceUrl || fileName;

    let text;
    try {
      text = await extractText(path.join(dir, fileName));
    } catch (err) {
      skipped.push(`${fileName}: could not read (${err.message})`);
      continue;
    }

    const analysis = Scoring.analyzeSyllabus(text);
    if (!analysis || text.trim().length < 200) {
      skipped.push(`${fileName}: no usable text (scanned image PDF or empty page?)`);
      continue;
    }

    const professor = overrides.professor || Detect.professor(text);
    if (!professor) {
      skipped.push(`${fileName}: no professor name found (set "professor" in manifest.json)`);
      continue;
    }
    const key = normalizeName(professor);
    if (!key) {
      skipped.push(`${fileName}: professor "${professor}" normalizes to an empty key`);
      continue;
    }

    const entry = {
      professor,
      courseCode: overrides.courseCode || Detect.courseCode(text) || null,
      courseTitle: overrides.courseTitle || null,
      term: overrides.term || Detect.term(text) || null,
      fileName,
      sourceUrl: overrides.sourceUrl || null,
      professorCurrentlyAtScu: overrides.professorCurrentlyAtScu || 'unknown',
      fairnessScore: analysis.fairness,
      difficultyScore: analysis.difficulty,
      signals: analysis.signals,
    };

    // A re-run may attribute a file to a different professor (e.g. after a
    // manifest fix), so drop its previous entry from every key.
    for (const k of Object.keys(existing)) {
      existing[k] = existing[k].filter((e) => (e.sourceUrl || e.fileName) !== identity);
      if (!existing[k].length) delete existing[k];
    }
    (existing[key] = existing[key] || []).push(entry);

    const why = analysis.signals.filter((s) => s.difficulty !== 0).map((s) => s.label).join(', ') || 'no strong signals';
    console.log(`OK   ${fileName} — ${professor} / ${entry.courseCode || '?'} / ${entry.term || '?'} → difficulty ${analysis.difficulty}, fairness ${analysis.fairness} (${why})`);
    imported++;
  }

  const sorted = {};
  for (const key of Object.keys(existing).sort()) {
    sorted[key] = existing[key].sort((a, b) => String(a.courseCode).localeCompare(String(b.courseCode)) || String(a.term).localeCompare(String(b.term)));
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(sorted, null, 2) + '\n');

  for (const s of skipped) console.log(`SKIP ${s}`);
  console.log(`\nImported ${imported}, skipped ${skipped.length}. Wrote ${out}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { htmlToText };
