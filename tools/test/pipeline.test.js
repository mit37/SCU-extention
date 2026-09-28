// End-to-end: a local HTTP server stands in for faculty web pages, then
// fetch-syllabi.js downloads from it and ingest-syllabi.js scores the result.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { makePdf, HARD_SYLLABUS, EASY_SYLLABUS } = require('./helpers.js');
const { htmlToText } = require('../ingest-syllabi.js');
const { fileNameFor } = require('../fetch-syllabi.js');

const run = promisify(execFile);
const TOOLS = path.join(__dirname, '..');

const COURSE_HTML = `<!doctype html><html><head><title>CSCI 60</title><style>p{color:red}</style>
<script>var x = "Instructor: Not A Name";</script></head><body>
<h1>CSCI 60 Object-Oriented Programming &mdash; Spring 2025</h1>
<p>Instructor: Prof. Carlos Diaz &lt;cdiaz@scu.edu&gt;</p>
<ul><li>Weekly quizzes every Friday</li><li>Two midterms and a comprehensive final</li>
<li>Late work will not be accepted.</li><li>Exams: 75% of the course grade</li></ul>
<p>Detailed schedule, readings, and lab expectations are posted on Camino each week.</p>
</body></html>`;

test('htmlToText drops scripts/styles and decodes entities', () => {
  const text = htmlToText(COURSE_HTML);
  assert.ok(!text.includes('Not A Name'));
  assert.ok(!text.includes('color:red'));
  assert.ok(text.includes('Instructor: Prof. Carlos Diaz <cdiaz@scu.edu>'));
  assert.ok(text.includes('— Spring 2025'));
});

test('fileNameFor is stable, unique per URL, and readable', () => {
  const a = fileNameFor('https://www.cse.scu.edu/~m1wang/database/Syllabus280.pdf', 'pdf');
  assert.equal(a, fileNameFor('https://www.cse.scu.edu/~m1wang/database/Syllabus280.pdf', 'pdf'));
  assert.match(a, /^[0-9a-f]{10}-syllabus280\.pdf$/);
  assert.notEqual(a, fileNameFor('https://www.cse.scu.edu/~m1wang/os/Syllabus280.pdf', 'pdf'));
  assert.match(fileNameFor('https://www.engr.scu.edu/~x/Syllabus%20ECEN%20100.pdf', 'pdf'), /-syllabus-ecen-100\.pdf$/);
  assert.match(fileNameFor('https://x.scu.edu/bad%E0%A4%A.pdf', 'pdf'), /\.pdf$/);
});

test('fetch → ingest over a local server', async (t) => {
  const hits = {};
  let flakyCalls = 0;
  const server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (req.url === '/a/hard.pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      return res.end(makePdf(HARD_SYLLABUS));
    }
    if (req.url === '/b/course.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(COURSE_HTML);
    }
    if (req.url === '/c/fake.pdf') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><body>Please sign in</body></html>');
    }
    if (req.url === '/e/flaky.pdf') {
      flakyCalls++;
      if (flakyCalls === 1) {
        res.writeHead(503);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(makePdf(EASY_SYLLABUS));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scu-pipeline-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sourcesPath = path.join(tmp, 'sources.json');
  const downloads = path.join(tmp, 'downloads');
  const baseline = path.join(tmp, 'baseline.json');

  fs.writeFileSync(sourcesPath, JSON.stringify({
    sources: [
      { url: `${base}/a/hard.pdf`, professor: 'Ming-Hwa Wang', courseCode: 'COEN 280', courseTitle: 'Database Systems', term: 'Fall 2024', professorCurrentlyAtScu: 'yes' },
      { url: `${base}/b/course.html`, professor: '', courseCode: '', courseTitle: '', term: '' },
      { url: `${base}/c/fake.pdf`, professor: 'Nobody', courseCode: 'MATH 11', term: '' },
      { url: `${base}/d/missing.pdf`, professor: 'Nobody', courseCode: 'MATH 12', term: '' },
      { url: `${base}/e/flaky.pdf`, professor: 'Alice Nguyen', courseCode: 'MATH 53', term: 'Winter 2025' },
    ],
  }));

  const fetchArgs = [path.join(TOOLS, 'fetch-syllabi.js'), '--sources', sourcesPath, '--out', downloads];
  const first = await run('node', fetchArgs);
  assert.match(first.stdout, /3 available, 2 failed/);

  const report = JSON.parse(fs.readFileSync(path.join(downloads, 'fetch-report.json'), 'utf8'));
  const failures = Object.fromEntries(report.failed.map((f) => [new URL(f.url).pathname, f.reason]));
  assert.match(failures['/c/fake.pdf'], /unexpected content/);
  assert.match(failures['/d/missing.pdf'], /HTTP 404/);
  assert.equal(hits['/e/flaky.pdf'], 2, 'flaky endpoint should be retried once');

  const manifest = JSON.parse(fs.readFileSync(path.join(downloads, 'manifest.json'), 'utf8'));
  const files = Object.keys(manifest).sort();
  assert.equal(files.length, 3);
  assert.ok(files.some((f) => f.endsWith('-course.html')));

  // Second run must not re-download anything it already has.
  const before = { ...hits };
  const second = await run('node', fetchArgs);
  assert.match(second.stdout, /3 available, 2 failed/);
  assert.equal(hits['/a/hard.pdf'], before['/a/hard.pdf']);
  assert.equal(hits['/b/course.html'], before['/b/course.html']);

  const ingest = await run('node', [path.join(TOOLS, 'ingest-syllabi.js'), downloads, '--out', baseline]);
  assert.match(ingest.stdout, /Imported 3, skipped 0/);
  const data = JSON.parse(fs.readFileSync(baseline, 'utf8'));
  assert.deepEqual(Object.keys(data).sort(), ['alice nguyen', 'carlos diaz', 'hwa ming wang']);

  const wang = data['hwa ming wang'][0];
  assert.equal(wang.courseCode, 'COEN 280');
  assert.equal(wang.term, 'Fall 2024');
  assert.equal(wang.professorCurrentlyAtScu, 'yes');
  assert.equal(wang.sourceUrl, `${base}/a/hard.pdf`);
  assert.ok(wang.difficultyScore >= 80);

  const diaz = data['carlos diaz'][0];
  assert.equal(diaz.courseCode, 'CSCI 60', 'detected from HTML when manifest has none');
  assert.equal(diaz.term, 'Spring 2025');
  assert.ok(diaz.difficultyScore > data['alice nguyen'][0].difficultyScore);

  // Re-ingesting is idempotent.
  await run('node', [path.join(TOOLS, 'ingest-syllabi.js'), downloads, '--out', baseline]);
  assert.deepEqual(JSON.parse(fs.readFileSync(baseline, 'utf8')), data);
});

test('ingest skips scanned/empty PDFs and PDFs with no professor', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scu-ingest-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmp, 'blank.pdf'), makePdf([]));
  fs.writeFileSync(path.join(tmp, 'anon.pdf'), makePdf(EASY_SYLLABUS.filter((l) => !/Instructor|Alice/.test(l))));
  fs.writeFileSync(path.join(tmp, 'named.pdf'), makePdf(EASY_SYLLABUS.filter((l) => !/Instructor|Alice/.test(l))));
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ 'named.pdf': { professor: 'Alice Nguyen' } }));

  const out = path.join(tmp, 'out.json');
  const { stdout } = await run('node', [path.join(TOOLS, 'ingest-syllabi.js'), tmp, '--out', out]);
  assert.match(stdout, /SKIP anon\.pdf: no professor name found/);
  assert.match(stdout, /SKIP blank\.pdf: no usable text/);
  assert.match(stdout, /Imported 1, skipped 2/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8'))), ['alice nguyen']);
});
