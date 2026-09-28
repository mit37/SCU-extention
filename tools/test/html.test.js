const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../../extension/lib/html.js');

test('escapes markup and attribute breakouts', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("O'Brien & Co"), 'O&#39;Brien &amp; Co');
});

test('handles non-strings', () => {
  assert.equal(escapeHtml(4.5), '4.5');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});
