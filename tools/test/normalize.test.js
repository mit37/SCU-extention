const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName } = require('../../extension/lib/rmp.js');

test('Workday, typed, and syllabus-header forms collide', () => {
  const key = normalizeName('Jane Smith');
  assert.equal(key, 'jane smith');
  for (const form of ['Smith,Jane', 'Smith, Jane', 'Dr. Jane Q. Smith', 'Smith, Jane Q', 'Prof. Jane Smith', 'JANE SMITH']) {
    assert.equal(normalizeName(form), key, form);
  }
});

test('hyphenated names split consistently', () => {
  assert.equal(normalizeName('Ming-Hwa Wang'), normalizeName('Wang, Ming-Hwa'));
  assert.equal(normalizeName('Ming-Hwa Wang'), 'hwa ming wang');
});

test('empty/noise-only input normalizes to empty key', () => {
  assert.equal(normalizeName('Dr.'), '');
  assert.equal(normalizeName(''), '');
});
