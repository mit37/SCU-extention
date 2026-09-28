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
const crypto = require('crypto');
const zlib = require('zlib');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const { normalizeName } = require('../extension/lib/rmp.js');
const Scoring = require('../extension/lib/scoring.js');
const Detect = require('../extension/lib/detect.js');

const STANDARD_FONTS = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
const SUPPORTED = /\.(pdf|html?|xml|docx)$/i;

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

// Minimal zip reader — enough to pull one entry out of a .docx without a
// dependency. Walks the central directory, then inflates the entry.
function unzipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeader = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === wanted) {
      const start = localHeader + 30 + buf.readUInt16LE(localHeader + 26) + buf.readUInt16LE(localHeader + 28);
      const data = buf.subarray(start, start + compressedSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`unsupported zip compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} not found in archive`);
}

function docxText(buf) {
  const xml = unzipEntry(buf, 'word/document.xml').toString('utf8');
  return htmlToText(xml.replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>|<\/w:p>/g, '<br>'));
}

async function extractText(filePath) {
  if (/\.pdf$/i.test(filePath)) return pdfText(filePath);
  if (/\.docx$/i.test(filePath)) return docxText(fs.readFileSync(filePath));
  const markup = fs.readFileSync(filePath, 'utf8');
  // XML syllabi have no block-level HTML tags, so break on every element.
  if (/\.xml$/i.test(filePath)) return htmlToText(markup.replace(/<\/[^>]+>/g, '$&\n'));
  return htmlToText(markup);
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
    console.error(`No .pdf/.html/.xml/.docx files found in ${dir}`);
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
    if (!Detect.looksLikeSyllabus(text)) {
      skipped.push(`${fileName}: doesn't read like a syllabus (no grading/exam/policy content)`);
      continue;
    }

    // The same syllabus is often hosted at two paths; count it once.
    const contentHash = crypto.createHash('sha1').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
    const twin = Object.values(existing).flat().find((e) => e.contentHash === contentHash && (e.sourceUrl || e.fileName) !== identity);
    if (twin) {
      skipped.push(`${fileName}: duplicate of ${twin.sourceUrl || twin.fileName}`);
      continue;
    }

    // Search-sourced metadata is a hint; the document's own "Instructor:" line
    // is authoritative. Hand-written manifest entries are the reverse.
    const detected = Detect.professor(text);
    const professor = overrides.metadataSource === 'search'
      ? detected || overrides.professor
      : overrides.professor || detected;
    if (!professor) {
      skipped.push(`${fileName}: no professor name found (set "professor" in manifest.json)`);
      continue;
    }
    if (overrides.metadataSource === 'search' && detected && overrides.professor
        && normalizeName(detected) !== normalizeName(overrides.professor)) {
      console.log(`NOTE ${fileName}: search said "${overrides.professor}", document says "${detected}" — using the document`);
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
      contentHash,
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

module.exports = { htmlToText, docxText };
