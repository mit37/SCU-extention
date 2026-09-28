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
const { makePdf, makeDocx, HARD_SYLLABUS, EASY_SYLLABUS } = require('./helpers.js');
const { htmlToText, docxText } = require('../ingest-syllabi.js');
const { fileNameFor, classify } = require('../fetch-syllabi.js');

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

const XML_SYLLABUS = `<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="syllabus.xsl"?>
<syllabus><course>COEN 21 Introduction to Logic Design</course><term>Fall 2016</term>
<instructor>Instructor: Kevin Lee</instructor>
<grading>Midterm exam 30%, Final exam 40%, Labs 30%. Weekly labs are required. Late labs will not be accepted.</grading>
<policies>Attendance is required. Office hours: Tuesday 2-4pm. Textbook: Digital Design, 5th edition.</policies></syllabus>`;

const DOCX_LINES = [
  'PSYC 193 Research Seminar',
  'Spring 2026',
  'Instructor: Priya Raman',
  'Grading: Research paper 50%, Presentation 25%, Participation 25%.',
  'The final research paper should be 15-20 pages. There is no final exam.',
  'Office hours by appointment. Readings are posted on Camino each week.',
];

const PROGRAM_PAGE = `<html><body><h1>Electrical Engineering Program</h1>
<p>The ECEN program prepares students for careers in industry and research across Silicon Valley.
Students complete a senior design capstone with industry partners. Apply now to join our community
of innovators, and contact the department for more information about admission and scholarships.</p></body></html>`;

test('htmlToText drops scripts/styles and decodes entities', () => {
  const text = htmlToText(COURSE_HTML);
  assert.ok(!text.includes('Not A Name'));
  assert.ok(!text.includes('color:red'));
  assert.ok(text.includes('Instructor: Prof. Carlos Diaz <cdiaz@scu.edu>'));
  assert.ok(text.includes('— Spring 2025'));
});

test('docxText reads paragraphs out of a .docx', () => {
  const text = docxText(makeDocx(DOCX_LINES));
  assert.ok(text.includes('Instructor: Priya Raman\n'), text);
  assert.ok(text.includes('15-20 pages'));
});

test('fileNameFor is stable, unique per URL, and readable', () => {
  const a = fileNameFor('https://www.cse.scu.edu/~m1wang/database/Syllabus280.pdf', 'pdf');
  assert.equal(a, fileNameFor('https://www.cse.scu.edu/~m1wang/database/Syllabus280.pdf', 'pdf'));
  assert.match(a, /^[0-9a-f]{10}-syllabus280\.pdf$/);
  assert.notEqual(a, fileNameFor('https://www.cse.scu.edu/~m1wang/os/Syllabus280.pdf', 'pdf'));
  assert.match(fileNameFor('https://www.engr.scu.edu/~x/Syllabus%20ECEN%20100.pdf', 'pdf'), /-syllabus-ecen-100\.pdf$/);
  assert.match(fileNameFor('https://x.scu.edu/bad%E0%A4%A.pdf', 'pdf'), /\.pdf$/);
  assert.match(fileNameFor('http://syllabi.engr.scu.edu/x/COEN-021-Fall-2016.xml', 'xml'), /-coen-021-fall-2016\.xml$/);
});

test('classify trusts bytes over labels', () => {
  const pdf = makePdf(['x']);
  const docx = makeDocx(['x']);
  const html = Buffer.from('<html><body>hi</body></html>');
  const xml = Buffer.from('<?xml version="1.0"?><syllabus/>');
  assert.equal(classify('https://a.scu.edu/s.pdf', 'application/octet-stream', pdf), 'pdf');
  assert.equal(classify('https://a.scu.edu/s', 'text/html', pdf), 'pdf');
  assert.equal(classify('https://a.scu.edu/s.pdf', 'text/html', html), null, 'login page served for a PDF');
  assert.equal(classify('https://a.scu.edu/s.docx', 'application/octet-stream', docx), 'docx');
  assert.equal(classify('https://a.scu.edu/s.docx', 'text/html', html), null);
  assert.equal(classify('https://a.scu.edu/s.doc', 'application/msword', Buffer.from('\xd0\xcf\x11\xe0')), null, 'legacy .doc unsupported');
  assert.equal(classify('https://a.scu.edu/s.xml', 'text/xml', xml), 'xml');
  assert.equal(classify('https://a.scu.edu/s.shtml', '', html), 'html');
  assert.equal(classify('https://a.scu.edu/s', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])), null);
});

test('fetch → ingest over a local server', async (t) => {
  const hits = {};
  let flakyCalls = 0;
  const hard = makePdf(HARD_SYLLABUS);
  const routes = {
    '/a/hard.pdf': ['application/pdf', hard],
    '/h/copy-of-hard.pdf': ['application/pdf', hard],
    '/b/course.html': ['text/html; charset=utf-8', COURSE_HTML],
    '/c/fake.pdf': ['text/html', '<html><body>Please sign in</body></html>'],
    '/f/seminar.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', makeDocx(DOCX_LINES)],
    '/g/COEN-021-Fall-2016.xml': ['text/xml', XML_SYLLABUS],
    '/i/program.html': ['text/html', PROGRAM_PAGE],
  };
  const server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (req.url === '/e/flaky.pdf') {
      if (++flakyCalls === 1) {
        res.writeHead(503);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(makePdf(EASY_SYLLABUS));
    }
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': route[0] });
    res.end(route[1]);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scu-pipeline-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const sourcesPath = path.join(tmp, 'sources.json');
  const downloads = path.join(tmp, 'downloads');
  const baseline = path.join(tmp, 'baseline.json');

  // "M. Wang" mimics a search snippet that disagrees with the document's own
  // "Instructor: Dr. Ming-Hwa Wang" line — the document should win.
  fs.writeFileSync(sourcesPath, JSON.stringify({
    sources: [
      { url: `${base}/a/hard.pdf`, professor: 'M. Wang', courseCode: 'COEN 280', courseTitle: 'Database Systems', term: 'Fall 2024' },
      { url: `${base}/h/copy-of-hard.pdf`, professor: 'M. Wang', courseCode: 'COEN 280', term: 'Fall 2024' },
      { url: `${base}/b/course.html`, professor: '', courseCode: '', courseTitle: '', term: '' },
      { url: `${base}/c/fake.pdf`, professor: 'Nobody', courseCode: 'MATH 11', term: '' },
      { url: `${base}/d/missing.pdf`, professor: 'Nobody', courseCode: 'MATH 12', term: '' },
      { url: `${base}/e/flaky.pdf`, professor: 'Alice Nguyen', courseCode: 'MATH 53', term: 'Winter 2025' },
      { url: `${base}/f/seminar.docx`, professor: '', courseCode: 'PSYC 193', term: 'Spring 2026' },
      { url: `${base}/g/COEN-021-Fall-2016.xml`, professor: '', courseCode: 'COEN 21', term: 'Fall 2016' },
      { url: `${base}/i/program.html`, professor: '', courseCode: 'ECEN 1', term: '' },
    ],
  }));

  const fetchArgs = [path.join(TOOLS, 'fetch-syllabi.js'), '--sources', sourcesPath, '--out', downloads];
  const first = await run('node', fetchArgs);
  assert.match(first.stdout, /7 available, 2 failed/);

  const report = JSON.parse(fs.readFileSync(path.join(downloads, 'fetch-report.json'), 'utf8'));
  const failures = Object.fromEntries(report.failed.map((f) => [new URL(f.url).pathname, f.reason]));
  assert.match(failures['/c/fake.pdf'], /unexpected content/);
  assert.match(failures['/d/missing.pdf'], /HTTP 404/);
  assert.equal(hits['/e/flaky.pdf'], 2, 'flaky endpoint should be retried once');

  const manifest = JSON.parse(fs.readFileSync(path.join(downloads, 'manifest.json'), 'utf8'));
  const files = Object.keys(manifest).sort();
  assert.equal(files.length, 7);
  assert.ok(files.some((f) => f.endsWith('-seminar.docx')));
  assert.ok(files.some((f) => f.endsWith('-coen-021-fall-2016.xml')));
  assert.ok(Object.values(manifest).every((m) => m.metadataSource === 'search'));

  // Second run must not re-download anything it already has.
  const before = { ...hits };
  const second = await run('node', fetchArgs);
  assert.match(second.stdout, /7 available, 2 failed/);
  for (const p of ['/a/hard.pdf', '/b/course.html', '/f/seminar.docx']) assert.equal(hits[p], before[p], p);

  const ingest = await run('node', [path.join(TOOLS, 'ingest-syllabi.js'), downloads, '--out', baseline]);
  assert.match(ingest.stdout, /Imported 5, skipped 2/);
  assert.match(ingest.stdout, /SKIP .*program\.html: doesn't read like a syllabus/);
  assert.match(ingest.stdout, /SKIP .*: duplicate of .*hard\.pdf/);
  assert.match(ingest.stdout, /NOTE .*search said "M\. Wang", document says "Ming-Hwa Wang"/);

  const data = JSON.parse(fs.readFileSync(baseline, 'utf8'));
  assert.deepEqual(Object.keys(data).sort(), ['alice nguyen', 'carlos diaz', 'hwa ming wang', 'kevin lee', 'priya raman']);

  assert.equal(data['hwa ming wang'].length, 1, 'duplicate copy counted once');
  const wang = data['hwa ming wang'][0];
  assert.equal(wang.professor, 'Ming-Hwa Wang');
  assert.equal(wang.courseCode, 'COEN 280');
  assert.equal(wang.term, 'Fall 2024');
  assert.ok(wang.difficultyScore >= 80);

  const diaz = data['carlos diaz'][0];
  assert.equal(diaz.courseCode, 'CSCI 60', 'detected from HTML when manifest has none');
  assert.equal(diaz.term, 'Spring 2025');
  assert.ok(diaz.difficultyScore > data['alice nguyen'][0].difficultyScore);

  const raman = data['priya raman'][0];
  assert.ok(raman.signals.some((s) => s.label === '20-page paper'), JSON.stringify(raman.signals));
  assert.equal(data['kevin lee'][0].courseCode, 'COEN 21');

  // Re-ingesting is idempotent.
  await run('node', [path.join(TOOLS, 'ingest-syllabi.js'), downloads, '--out', baseline]);
  assert.deepEqual(JSON.parse(fs.readFileSync(baseline, 'utf8')), data);
});

test('ingest skips scanned/empty PDFs and PDFs with no professor', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scu-ingest-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const anonymous = EASY_SYLLABUS.filter((l) => !/Instructor|Alice/.test(l));
  fs.writeFileSync(path.join(tmp, 'blank.pdf'), makePdf([]));
  fs.writeFileSync(path.join(tmp, 'anon.pdf'), makePdf(anonymous));
  fs.writeFileSync(path.join(tmp, 'named.pdf'), makePdf([...anonymous, 'Section 2']));
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ 'named.pdf': { professor: 'Alice Nguyen' } }));

  const out = path.join(tmp, 'out.json');
  const { stdout } = await run('node', [path.join(TOOLS, 'ingest-syllabi.js'), tmp, '--out', out]);
  assert.match(stdout, /SKIP anon\.pdf: no professor name found/);
  assert.match(stdout, /SKIP blank\.pdf: no usable text/);
  assert.match(stdout, /Imported 1, skipped 2/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8'))), ['alice nguyen']);
});

test('hand-written manifest professor beats the document', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scu-override-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmp, 'x.pdf'), makePdf(EASY_SYLLABUS));
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ 'x.pdf': { professor: 'Alicia Nguyen-Park' } }));
  const out = path.join(tmp, 'out.json');
  await run('node', [path.join(TOOLS, 'ingest-syllabi.js'), tmp, '--out', out]);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8'))), ['alicia nguyen park']);
});
