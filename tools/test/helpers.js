// Builds a minimal but valid single-page PDF with one text line per entry,
// so tests exercise real pdf.js text extraction (including hasEOL).
function makePdf(lines) {
  const esc = (s) => s.replace(/[()\\]/g, (c) => `\\${c}`);
  const height = 60 + lines.length * 14;
  const content = lines
    .map((l, i) => `BT /F1 10 Tf 20 ${height - 30 - i * 14} Td (${esc(l)}) Tj ET`)
    .join('\n') + '\n';
  const stream = Buffer.from(content, 'latin1');
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 ${height}] /Contents 5 0 R >>\nendobj\n`,
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${content}endstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += o;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// Minimal .docx: a zip whose word/document.xml has one <w:p> per line.
function makeDocx(lines) {
  const zlib = require('zlib');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')
    + '</w:body></w:document>';
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: 'word/document.xml', data: Buffer.from(xml) },
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const compressed = zlib.deflateRawSync(e.data);
    const crc = zlib.crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const HARD_SYLLABUS = [
  'COEN 280 Database Systems',
  'Santa Clara University, Fall Quarter 2024',
  'Instructor: Dr. Ming-Hwa Wang, Ph.D.',
  'Office: Heafey 201   Email: mwang@scu.edu',
  'Grading:',
  'Midterm 1: 25%',
  'Midterm 2: 25%',
  'Final exam (cumulative): 30%',
  'Homework: 20%',
  'Weekly homework is due every Monday. No late work will be accepted.',
  'There will be no make-up exams. Grades are not curved.',
  'The final exam is cumulative and closed book.',
  'A 93-100%, A- 90-92%, B+ 87-89%',
];

const EASY_SYLLABUS = [
  'MATH 53 Linear Algebra',
  'Winter 2025',
  'Instructor:',
  'Alice Nguyen',
  'Course grade: Homework 40%, Project 35%, Participation 25%. There is no final exam.',
  'The lowest homework score will be dropped, and extra credit is available.',
  'Each student gets three late days with a 48-hour grace period, no questions asked.',
  'Quizzes are open book. Resubmissions are allowed for the project.',
  'Office hours are listed on Camino.',
];

module.exports = { makePdf, makeDocx, HARD_SYLLABUS, EASY_SYLLABUS };
