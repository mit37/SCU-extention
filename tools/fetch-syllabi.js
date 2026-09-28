#!/usr/bin/env node
// Downloads every syllabus listed in public-syllabi-sources.json into a local
// folder and writes a manifest.json there carrying each file's verified
// metadata, ready for ingest-syllabi.js.
//
// Usage: node fetch-syllabi.js [--sources <json>] [--out <dir>] [--force]
//
// Polite by design: one request at a time, a pause between requests, a
// descriptive User-Agent, and no re-download of files already on disk.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USER_AGENT = 'SCU-Course-Companion-baseline-builder/0.1 (+https://github.com/mit37/SCU-extention)';
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 30000;
const PAUSE_MS = 1000;
const RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = {
    sources: path.join(__dirname, 'public-syllabi-sources.json'),
    out: path.join(__dirname, 'downloads'),
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sources') args.sources = path.resolve(argv[++i]);
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--force') args.force = true;
  }
  return args;
}

// Stable across runs (so re-runs skip what's already downloaded) and unique
// per URL, while keeping the original filename readable.
function fileNameFor(url, kind) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() || 'index';
  let decoded;
  try { decoded = decodeURIComponent(last); } catch { decoded = last; }
  const base = decoded
    .toLowerCase()
    .replace(/\.(pdf|s?html?|php|aspx?|xml|docx?|cgi)$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'syllabus';
  return `${hash}-${base}.${kind}`;
}

// Decides by the bytes first, since servers mislabel content types. A URL
// or header claiming PDF/DOCX whose bytes aren't that format is rejected:
// it's usually a login or error page served in its place.
function classify(url, contentType, bytes) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const isZip = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50;
  if (isZip && (/wordprocessingml/i.test(contentType) || pathname.endsWith('.docx'))) return 'docx';
  if (/pdf|wordprocessingml|msword/i.test(contentType) || /\.(pdf|docx?)$/.test(pathname)) return null;
  const startsWithMarkup = /^\s*</.test(bytes.subarray(0, 512).toString('utf8').replace(/^﻿/, ''));
  if (!startsWithMarkup) return null;
  if (/[/+]xml/i.test(contentType) || pathname.endsWith('.xml')) return 'xml';
  if (/text\/html|application\/xhtml/i.test(contentType) || /\.s?html?$/.test(pathname) || !contentType) return 'html';
  return null;
}

async function download(url) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await sleep(2000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/pdf,text/html;q=0.9,application/xml;q=0.8,*/*;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > MAX_BYTES) return { error: `too large (${declared} bytes)` };
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_BYTES) return { error: `too large (${bytes.length} bytes)` };
      const kind = classify(res.url || url, res.headers.get('content-type') || '', bytes);
      if (!kind) return { error: `unexpected content (${res.headers.get('content-type') || 'no content-type'})` };
      return { bytes, kind, finalUrl: res.url || url };
    } catch (err) {
      lastError = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code || err.message);
    }
  }
  return { error: `failed after ${RETRIES + 1} attempts (${lastError})` };
}

async function main() {
  const { sources: sourcesPath, out, force } = parseArgs(process.argv.slice(2));
  const { sources } = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
  if (!Array.isArray(sources) || !sources.length) {
    console.error(`No sources in ${sourcesPath}`);
    process.exit(1);
  }

  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    console.warn('Note: HTTPS_PROXY is set but Node\'s fetch ignores it unless NODE_USE_ENV_PROXY=1 (Node >= 22.21).\n');
  }

  fs.mkdirSync(out, { recursive: true });
  const manifestPath = path.join(out, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const existingByUrl = new Map(Object.entries(manifest).map(([file, m]) => [m.sourceUrl, file]));

  const ok = [];
  const failed = [];
  let fetched = 0;

  for (const [i, src] of sources.entries()) {
    const label = `[${i + 1}/${sources.length}] ${src.url}`;
    const already = existingByUrl.get(src.url);
    if (already && !force && fs.existsSync(path.join(out, already))) {
      console.log(`have ${label}`);
      ok.push(src.url);
      continue;
    }

    const result = await download(src.url);
    fetched++;
    if (result.error) {
      console.log(`FAIL ${label} — ${result.error}`);
      failed.push({ url: src.url, reason: result.error });
    } else {
      const fileName = fileNameFor(src.url, result.kind);
      fs.writeFileSync(path.join(out, fileName), result.bytes);
      manifest[fileName] = {
        professor: src.professor || '',
        courseCode: src.courseCode || '',
        courseTitle: src.courseTitle || '',
        term: src.term || '',
        sourceUrl: src.url,
        professorCurrentlyAtScu: src.professorCurrentlyAtScu || 'unknown',
        // Came from search-result titles/snippets: ingest lets the document's
        // own "Instructor:" line win over it.
        metadataSource: 'search',
      };
      console.log(`ok   ${label} → ${fileName}`);
      ok.push(src.url);
    }
    if (i < sources.length - 1) await sleep(PAUSE_MS);
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'fetch-report.json'), JSON.stringify({ ok, failed }, null, 2) + '\n');
  console.log(`\n${ok.length} available, ${failed.length} failed (${fetched} requests). Details: ${path.join(out, 'fetch-report.json')}`);

  if (ok.length === 0) {
    console.error('Nothing downloaded — if every request failed with a network/proxy error, this machine cannot reach the hosts.');
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { fileNameFor, classify };
