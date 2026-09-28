const test = require('node:test');
const assert = require('node:assert/strict');
const Detect = require('../../extension/lib/detect.js');

test('professor: strips titles and credentials', () => {
  assert.equal(Detect.professor('Instructor: Dr. Ming-Hwa Wang, Ph.D.\n'), 'Ming-Hwa Wang');
  assert.equal(Detect.professor('Instructor: Ming-Hwa Wang PhD\n'), 'Ming-Hwa Wang');
  assert.equal(Detect.professor('Professor Jane Smith\n'), 'Jane Smith');
});

test('professor: stops at contact details on the same line', () => {
  assert.equal(Detect.professor('Instructor: Mary Smith (msmith@scu.edu)\n'), 'Mary Smith');
  assert.equal(Detect.professor('Instructor: Mary Smith   Office: Kenna 301\n'), 'Mary Smith');
  assert.equal(Detect.professor('Instructor: Mary Smith Office: Kenna 301\n'), 'Mary Smith');
  assert.equal(Detect.professor('Instructor Name: Mary Smith\n'), 'Mary Smith');
});

test('professor: name on the line after a bare label', () => {
  assert.equal(Detect.professor('Instructor:\n\nAlice Nguyen\nOffice hours: TBA\n'), 'Alice Nguyen');
});

test('professor: keeps middle initials, handles all caps', () => {
  assert.equal(Detect.professor('Instructor: John Q. Public\n'), 'John Q. Public');
  assert.equal(Detect.professor('INSTRUCTOR: JOHN SMITH\n'), 'JOHN SMITH');
});

test('professor: ignores prose mentions and placeholders', () => {
  assert.equal(Detect.professor('Some course with no clear instructor line here.\n'), null);
  assert.equal(Detect.professor('The professor will post grades weekly.\n'), null);
  assert.equal(Detect.professor('Professor of Computer Engineering\n'), null);
  assert.equal(Detect.professor('Instructor: TBA\n'), null);
  assert.equal(Detect.professor('Instructor Information\nEmail: x@scu.edu\n'), null);
  assert.equal(Detect.professor(''), null);
});

test('professor: skips a prose mention and finds the real label later', () => {
  const text = 'Contact the professor early.\nInstructor: Alice Nguyen\n';
  assert.equal(Detect.professor(text), 'Alice Nguyen');
});

test('professor: religious titles and S.J. / Jr. suffixes', () => {
  assert.equal(Detect.professor('Instructor: Fr. James Okafor\n'), 'James Okafor');
  assert.equal(Detect.professor('Instructor: Rev. Mary Jones\n'), 'Mary Jones');
  assert.equal(Detect.professor('Instructor: Dennis C. Smolarski S.J.\n'), 'Dennis C. Smolarski');
  assert.equal(Detect.professor('Instructor: Father Robert McKay, PhD., BCC\n'), 'Robert McKay');
  assert.equal(Detect.professor('Instructor: Jane Smith M.A.\n'), 'Jane Smith');
});

test('professor: surnames that look like degree abbreviations', () => {
  assert.equal(Detect.professor('Instructor: Yi Ma\n'), 'Yi Ma');
  assert.equal(Detect.professor('Instructor: Jd Ms\n'), 'Jd Ms');
});

test('professor: names that are also seasons or place words', () => {
  assert.equal(Detect.professor('Instructor: Summer Lee\n'), 'Summer Lee');
  assert.equal(Detect.professor('Instructor: John Winter\n'), 'John Winter');
  assert.equal(Detect.professor('Instructor: Clara Chen\n'), 'Clara Chen');
});

test('professor: run-together lines stop at syllabus words, terms, and the school name', () => {
  assert.equal(Detect.professor('Instructor: Kevin Lee Midterm exam 30%, Final 40%\n'), 'Kevin Lee');
  assert.equal(Detect.professor('Instructor: Jane Smith Fall 2024 Grading\n'), 'Jane Smith');
  assert.equal(Detect.professor('Instructor: Jane Smith Santa Clara University\n'), 'Jane Smith');
});

test('courseCode: only real SCU prefixes, normalized spacing', () => {
  assert.equal(Detect.courseCode('Meets MW 10:00 AM 12 in ROOM 204. COEN 280 Database'), 'COEN 280');
  assert.equal(Detect.courseCode('COEN280'), 'COEN 280');
  assert.equal(Detect.courseCode('CSEN-146L lab'), 'CSEN 146L');
  assert.equal(Detect.courseCode('HW 3 due'), null);
});

test('courseCode: graduate prefixes and four-digit numbers seen in real SCU syllabi', () => {
  assert.equal(Detect.courseCode('MSIS 2634: Natural Language Processing'), 'MSIS 2634');
  assert.equal(Detect.courseCode('PMIN 280 Summer 2025 Syllabus'), 'PMIN 280');
  for (const code of ['THEO 252', 'PLIT 221', 'CATE 222', 'SPIR 290', 'RJUS 221', 'SCTR 132']) {
    assert.equal(Detect.courseCode(`${code} Syllabus`), code);
  }
});

test('looksLikeSyllabus: policy-bearing documents only', () => {
  assert.ok(Detect.looksLikeSyllabus('Grading: Midterm 30%, Final 40%, Homework 30%. Office hours MW 2-3.'));
  assert.ok(!Detect.looksLikeSyllabus('The Electrical Engineering program prepares students for careers in industry. Apply now.'));
  assert.ok(!Detect.looksLikeSyllabus(''));
});

test('term: season + year variants', () => {
  assert.equal(Detect.term('Fall Quarter 2024'), 'Fall 2024');
  assert.equal(Detect.term('WINTER 2016'), 'Winter 2016');
  assert.equal(Detect.term('Spring, 2025'), 'Spring 2025');
  assert.equal(Detect.term('no term here'), null);
});

test('textFromPdfContent: honors hasEOL', () => {
  const items = [{ str: 'Instructor:', hasEOL: false }, { str: 'Jane Smith', hasEOL: true }, { str: 'Grading', hasEOL: true }];
  assert.equal(Detect.textFromPdfContent(items), 'Instructor: Jane Smith\nGrading\n\n');
});
