// For interpolating RMP data, page text, and friends' share codes into
// innerHTML templates — none of those sources are ours to trust.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (typeof module !== 'undefined') module.exports = { escapeHtml };
