// Finds professor names on SCU/Workday course pages and annotates them with
// a Likeness Score badge. Workday's DOM is a deeply nested, class-obfuscated
// SPA grid, so instead of relying on fixed selectors we pattern-match on the
// two shapes instructor names actually take: "Last, First" (Workday's own
// rendering) and "First Last" sitting near an "Instructor" label.
const LASTFIRST_RE = /^[A-Z][A-Za-z'\-]+,\s?[A-Z][A-Za-z'\-.]+(?:\s[A-Z][A-Za-z'\-.]*)?$/;
const FIRSTLAST_RE = /^[A-Z][A-Za-z'\-.]+(?:\s[A-Z][A-Za-z'\-.]*)?\s[A-Z][A-Za-z'\-]+$/;
const COURSE_CODE_RE = /\b([A-Z]{2,5})\s?-?\s?(\d{1,3}[A-Z]?)\b/;
const INSTRUCTOR_LABEL_RE = /instructor|faculty|taught\s?by/i;
const processed = new WeakSet();
const MAX_NODES_PER_SCAN = 400;

function looksLikeName(text) {
  const t = text.trim();
  if (t.length < 4 || t.length > 40) return false;
  return LASTFIRST_RE.test(t) || FIRSTLAST_RE.test(t);
}

function nearbyHasInstructorLabel(el) {
  let node = el;
  for (let i = 0; i < 4 && node; i++) {
    const row = node.closest ? node.closest('tr, [role="row"], li, .gwt-Label, div') : null;
    if (row && INSTRUCTOR_LABEL_RE.test(row.getAttribute('aria-label') || '')) return true;
    node = node.parentElement;
  }
  return false;
}

function findCourseCodeNear(el) {
  const row = el.closest ? el.closest('tr, [role="row"], li') : null;
  const text = row ? row.textContent : el.parentElement?.textContent || '';
  const match = text.match(COURSE_CODE_RE);
  return match ? `${match[1]} ${match[2]}` : null;
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
  const scoreLine = result.score === null
    ? 'Not enough data yet'
    : `${result.score}% likeness (${result.confidence} confidence)`;

  panel.innerHTML = `
    <button class="scu-cc-close" aria-label="Close">×</button>
    <h4>${name}</h4>
    <div class="scu-cc-meta">${scoreLine}</div>
    ${p ? `
      <div class="scu-cc-row"><span>RMP rating</span><b>${p.avgRating ?? '—'} / 5</b></div>
      <div class="scu-cc-row"><span>Difficulty</span><b>${p.avgDifficulty ?? '—'} / 5</b></div>
      <div class="scu-cc-row"><span># ratings</span><b>${p.numRatings ?? '—'}</b></div>
      <div class="scu-cc-row"><span>Would take again</span><b>${p.wouldTakeAgainPercent >= 0 ? p.wouldTakeAgainPercent + '%' : '—'}</b></div>
      <div style="margin-top:6px"><a href="${p.profileUrl}" target="_blank" rel="noopener">View on RateMyProfessors →</a></div>
    ` : `<div>No RateMyProfessors match found for this name at SCU.</div>`}
    <div style="margin-top:4px; color:#666; font-size:11px;">${result.syllabusCount} syllabus upload(s) on file</div>
    <div>
      <button data-action="upload">Upload syllabus</button>
      <button data-action="add-schedule">Add to my schedule</button>
    </div>
    <input type="file" data-role="syllabus-file" accept=".pdf,.txt,.docx" style="display:none" />
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
    badge.textContent = result.score !== null ? `${result.score}%` : '?';
    badge.title = result.professor
      ? `${result.professor.avgRating ?? '—'}/5 on RateMyProfessors (${result.professor.numRatings ?? 0} ratings)`
      : 'No RateMyProfessor data yet — click for details';
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
