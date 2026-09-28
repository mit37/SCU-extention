// Finds professor names on SCU/Workday course pages and annotates them with
// a Likeness Score badge. Workday's DOM is a deeply nested, class-obfuscated
// SPA grid, so instead of relying on fixed selectors we pattern-match on the
// two shapes instructor names actually take: "Last, First" (Workday's own
// rendering) and "First Last" sitting near an "Instructor" label.
const LASTFIRST_RE = /^[A-Z][A-Za-z'\-]+,\s?[A-Z][A-Za-z'\-.]+(?:\s[A-Z][A-Za-z'\-.]*)?$/;
const FIRSTLAST_RE = /^[A-Z][A-Za-z'\-.]+(?:\s[A-Z][A-Za-z'\-.]*)?\s[A-Z][A-Za-z'\-]+$/;
const INSTRUCTOR_LABEL_RE = /instructor|faculty|taught\s?by/i;
// Two capitalized words is also what most UI chrome looks like ("Course
// Search", "Office Hours"), so reject anything containing these.
const UI_WORDS = new Set([
  'course', 'courses', 'search', 'instructor', 'instructors', 'section', 'class', 'schedule',
  'office', 'hours', 'details', 'meeting', 'patterns', 'location', 'room', 'enrolled',
  'open', 'closed', 'waitlist', 'quarter', 'university', 'faculty', 'staff', 'information',
  'home', 'page', 'view', 'all', 'session',
]);
// Summer, Winter, Clara, etc. are also real names, so these are rejected
// only as whole phrases.
const UI_PHRASE_RE = /^(?:santa clara|(?:fall|winter|spring|summer) (?:quarter|session|term|\d{4}))$/i;
const processed = new WeakSet();
const MAX_NODES_PER_SCAN = 400;

function looksLikeName(text) {
  const t = text.trim();
  if (t.length < 4 || t.length > 40) return false;
  if (UI_PHRASE_RE.test(t)) return false;
  if (t.split(/[\s,]+/).some((w) => UI_WORDS.has(w.toLowerCase()))) return false;
  return LASTFIRST_RE.test(t) || FIRSTLAST_RE.test(t);
}

function nearbyHasInstructorLabel(el) {
  let node = el;
  for (let i = 0; i < 3 && node; i++) {
    if (INSTRUCTOR_LABEL_RE.test(node.getAttribute?.('aria-label') || '')) return true;
    const text = node.textContent || '';
    if (text.length <= 200 && INSTRUCTOR_LABEL_RE.test(text)) return true;
    node = node.parentElement;
  }
  return false;
}

// textContent glues adjacent cells together ("12 seatsCOEN 280"), which
// destroys the word boundary the course-code pattern needs.
function textWithCellBreaks(root) {
  const parts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) parts.push(node.nodeValue);
  return parts.join(' ');
}

function findCourseCodeNear(el) {
  const row = el.closest('tr, [role="row"], li') || el.parentElement;
  return row ? Detect.courseCode(textWithCellBreaks(row)) : null;
}

function tierForScore(score) {
  if (score === null || score === undefined) return 'none';
  if (score >= 70) return 'high';
  if (score >= 45) return 'mid';
  return 'low';
}

function closePanel() {
  document.querySelectorAll('.scu-cc-panel').forEach((p) => p.remove());
}

function renderPanel(anchorEl, name, courseCode, result) {
  closePanel();
  const panel = document.createElement('div');
  panel.className = 'scu-cc-panel';

  const p = result.professor;
  const d = result.syllabusDifficulty;
  const scoreLine = result.score === null
    ? 'Not enough data yet'
    : `${result.score}% likeness (${result.confidence} confidence)`;

  panel.innerHTML = `
    <button class="scu-cc-close" aria-label="Close">×</button>
    <h4>${escapeHtml(name)}</h4>
    <div class="scu-cc-meta">${escapeHtml(scoreLine)}</div>
    ${p ? `
      <div class="scu-cc-row"><span>RMP rating</span><b>${escapeHtml(p.avgRating ?? '—')} / 5</b></div>
      <div class="scu-cc-row"><span>RMP difficulty</span><b>${escapeHtml(p.avgDifficulty ?? '—')} / 5</b></div>
      <div class="scu-cc-row"><span># ratings</span><b>${escapeHtml(p.numRatings ?? '—')}</b></div>
      <div class="scu-cc-row"><span>Would take again</span><b>${p.wouldTakeAgainPercent >= 0 ? escapeHtml(p.wouldTakeAgainPercent) + '%' : '—'}</b></div>
      <div style="margin-top:6px"><a href="${escapeHtml(p.profileUrl)}" target="_blank" rel="noopener">View on RateMyProfessors →</a></div>
    ` : `<div>No RateMyProfessors match found for this name at SCU.</div>`}
    ${d ? `
      <div class="scu-cc-row"><span>Syllabus difficulty</span><b>${escapeHtml(d.score)} / 100</b></div>
      ${d.harder.length ? `<div class="scu-cc-why">Harder: ${d.harder.map(escapeHtml).join(', ')}</div>` : ''}
      ${d.easier.length ? `<div class="scu-cc-why">Easier: ${d.easier.map(escapeHtml).join(', ')}</div>` : ''}
    ` : ''}
    <div style="margin-top:4px; color:#666; font-size:11px;">${escapeHtml(result.evalCount || 0)} official course eval(s) · ${escapeHtml(result.syllabusCount)} syllabus upload(s) on file</div>
    <div>
      <button data-action="upload">Upload syllabus</button>
      <button data-action="add-schedule">Add to my schedule</button>
    </div>
    <input type="file" data-role="syllabus-file" accept=".txt" style="display:none" />
  `;

  document.body.appendChild(panel);
  const rect = anchorEl.getBoundingClientRect();
  panel.style.top = `${window.scrollY + rect.bottom + 6}px`;
  panel.style.left = `${window.scrollX + Math.max(0, rect.left - 20)}px`;

  panel.querySelector('.scu-cc-close').addEventListener('click', closePanel);

  panel.querySelector('[data-action="upload"]').addEventListener('click', () => {
    panel.querySelector('[data-role="syllabus-file"]').click();
  });

  panel.querySelector('[data-role="syllabus-file"]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text().catch(() => '');
    chrome.runtime.sendMessage({
      type: 'ADD_SYLLABUS',
      professorName: name,
      courseCode,
      fileName: file.name,
      text,
    }, () => {
      panel.querySelector('.scu-cc-meta').textContent = 'Thanks! Syllabus added.';
    });
  });

  panel.querySelector('[data-action="add-schedule"]').addEventListener('click', async () => {
    chrome.runtime.sendMessage({
      type: 'ADD_TO_SCHEDULE',
      entry: {
        courseCode: courseCode || 'Unknown course',
        professor: name,
        addedAt: Date.now(),
        source: location.href,
      },
    }, () => {
      panel.querySelector('.scu-cc-meta').textContent = 'Added to My Schedule.';
    });
  });

  document.addEventListener('click', function outside(ev) {
    if (!panel.contains(ev.target) && ev.target !== anchorEl) {
      panel.remove();
      document.removeEventListener('click', outside);
    }
  }, { capture: true });
}

function annotate(el, name) {
  if (processed.has(el)) return;
  processed.add(el);

  const badge = document.createElement('span');
  badge.className = 'scu-cc-badge';
  badge.dataset.tier = 'none';
  badge.textContent = '…';
  el.insertAdjacentElement('afterend', badge);

  chrome.runtime.sendMessage({ type: 'LOOKUP_PROFESSOR', name }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      badge.textContent = '⚠';
      return;
    }
    const { result } = response;
    const tier = tierForScore(result.score);
    badge.dataset.tier = tier;
    badge.dataset.confidence = result.confidence;
    badge.textContent = result.score !== null ? `${result.score}%` : '?';
    const basis = result.professor
      ? `${result.professor.avgRating ?? '—'}/5 on RateMyProfessors (${result.professor.numRatings ?? 0} ratings)`
      : 'No RateMyProfessors data';
    badge.title = `${basis} · ${result.confidence} confidence — click for details`;
    badge.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const courseCode = findCourseCodeNear(el);
      renderPanel(badge, name, courseCode, result);
    });
  });
}

function scan(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest('.scu-cc-panel, .scu-cc-badge')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let count = 0;
  let node;
  while ((node = walker.nextNode()) && count < MAX_NODES_PER_SCAN) {
    const text = node.nodeValue.trim();
    const el = node.parentElement;
    if (!el || processed.has(el)) continue;
    if (!looksLikeName(text)) continue;
    // "Last, First" is a strong enough signal on its own (Workday's own
    // rendering); "First Last" needs a nearby "Instructor" label to avoid
    // false positives on random capitalized phrases.
    if (LASTFIRST_RE.test(text) || nearbyHasInstructorLabel(el)) {
      annotate(el, text);
      count++;
    }
  }
}

let scanTimer = null;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => scan(document.body), 600);
}

scheduleScan();
new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
