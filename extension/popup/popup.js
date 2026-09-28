document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// --- Professor lookup ---
document.getElementById('lookup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('lookup-input').value.trim();
  const resultEl = document.getElementById('lookup-result');
  resultEl.textContent = 'Searching…';

  chrome.runtime.sendMessage({ type: 'LOOKUP_PROFESSOR', name }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      resultEl.textContent = 'Something went wrong looking that up.';
      return;
    }
    const { result } = response;
    const tier = result.score === null ? 'none'
      : result.score >= 70 ? 'high'
      : result.score >= 45 ? 'mid' : 'low';
    const p = result.professor;
    const d = result.syllabusDifficulty;

    resultEl.innerHTML = `
      <div class="score tier-${tier}">${result.score !== null ? escapeHtml(result.score) + '%' : '—'}</div>
      <div>${escapeHtml(p ? p.name : name)}</div>
      ${p ? `
        <div>RMP: ${escapeHtml(p.avgRating)}/5 · Difficulty: ${escapeHtml(p.avgDifficulty)}/5 · ${escapeHtml(p.numRatings)} ratings</div>
        <div><a href="${escapeHtml(p.profileUrl)}" target="_blank" rel="noopener">View on RateMyProfessors →</a></div>
      ` : '<div>No RateMyProfessors match found at SCU.</div>'}
      ${d ? `
        <div class="difficulty">Syllabus difficulty: <b>${escapeHtml(d.score)}/100</b> (from ${escapeHtml(d.count)} syllabus${d.count === 1 ? '' : 'es'})</div>
        ${d.harder.length ? `<div class="meta">Harder: ${d.harder.map(escapeHtml).join(', ')}</div>` : ''}
        ${d.easier.length ? `<div class="meta">Easier: ${d.easier.map(escapeHtml).join(', ')}</div>` : ''}
      ` : ''}
      <div>${escapeHtml(result.evalCount || 0)} official course eval(s) &middot; ${escapeHtml(result.syllabusCount)} syllabus upload(s) on file</div>
    `;
  });
});

// --- My Schedule ---
async function renderSchedule() {
  const schedule = await Storage.getSchedule();
  const list = document.getElementById('schedule-list');
  list.innerHTML = '';
  schedule.forEach((entry, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(entry.courseCode)}${entry.professor ? ' — ' + escapeHtml(entry.professor) : ''}</span>
      <button data-idx="${idx}">✕</button>
    `;
    li.querySelector('button').addEventListener('click', async () => {
      const current = await Storage.getSchedule();
      current.splice(idx, 1);
      await Storage.setSchedule(current);
      renderSchedule();
    });
    list.appendChild(li);
  });
}

document.getElementById('add-course-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const courseCode = document.getElementById('course-code').value.trim();
  const professor = document.getElementById('course-professor').value.trim();
  if (!courseCode) return;
  const schedule = await Storage.getSchedule();
  schedule.push({ courseCode, professor, addedAt: Date.now() });
  await Storage.setSchedule(schedule);
  e.target.reset();
  renderSchedule();
});

async function getMyName() {
  let name = await Storage.getSync('myName', null);
  if (!name) {
    name = prompt('What name should friends see when you share your schedule?') || 'A friend';
    await Storage.setSync('myName', name);
  }
  return name;
}

function encodeShareCode(payload) {
  return btoa(encodeURIComponent(JSON.stringify(payload)));
}
function decodeShareCode(code) {
  return JSON.parse(decodeURIComponent(atob(code.trim())));
}

document.getElementById('copy-share-code').addEventListener('click', async () => {
  const [name, schedule] = await Promise.all([getMyName(), Storage.getSchedule()]);
  const code = encodeShareCode({ name, schedule });
  await navigator.clipboard.writeText(code);
  alert('Share code copied! Send it to a friend so they can add you.');
});

document.getElementById('email-share-code').addEventListener('click', async () => {
  const [name, schedule] = await Promise.all([getMyName(), Storage.getSchedule()]);
  const code = encodeShareCode({ name, schedule });
  const subject = encodeURIComponent(`${name}'s SCU schedule`);
  const body = encodeURIComponent(
    `Here's my schedule from SCU Course Companion:\n\n` +
    schedule.map((s) => `- ${s.courseCode}${s.professor ? ' (' + s.professor + ')' : ''}`).join('\n') +
    `\n\nTo see overlaps and sync in the extension, paste this code into the Friends tab:\n${code}`
  );
  chrome.tabs.create({ url: `mailto:?subject=${subject}&body=${body}` });
});

// --- Friends ---
async function renderFriends() {
  const [friends, mySchedule] = await Promise.all([Storage.getFriends(), Storage.getSchedule()]);
  const myCourses = new Set(mySchedule.map((s) => s.courseCode.toUpperCase()));
  const list = document.getElementById('friends-list');
  list.innerHTML = '';
  friends.forEach((friend, idx) => {
    const shared = friend.schedule.filter((s) => myCourses.has(s.courseCode.toUpperCase()));
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(friend.name)}<br/><span class="meta">${shared.length} shared class${shared.length === 1 ? '' : 'es'}${shared.length ? ': ' + shared.map((s) => escapeHtml(s.courseCode)).join(', ') : ''}</span></span>
      <button data-idx="${idx}">✕</button>
    `;
    li.querySelector('button').addEventListener('click', async () => {
      const current = await Storage.getFriends();
      current.splice(idx, 1);
      await Storage.setFriends(current);
      renderFriends();
    });
    list.appendChild(li);
  });
}

document.getElementById('import-friend-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('friend-code');
  try {
    const payload = decodeShareCode(input.value);
    if (!payload.name || !Array.isArray(payload.schedule)) throw new Error('bad payload');
    // Share codes come from other people; keep only the fields we render.
    const schedule = payload.schedule
      .filter((s) => s && typeof s.courseCode === 'string')
      .map((s) => ({ courseCode: s.courseCode.slice(0, 40), professor: String(s.professor || '').slice(0, 80) }));
    const friends = await Storage.getFriends();
    friends.push({ name: String(payload.name).slice(0, 60), schedule, addedAt: Date.now() });
    await Storage.setFriends(friends);
    input.value = '';
    renderFriends();
  } catch (err) {
    alert("That doesn't look like a valid share code.");
  }
});

renderSchedule();
renderFriends();
