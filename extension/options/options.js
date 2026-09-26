const statusEl = document.getElementById('status');
function flash(msg) {
  statusEl.textContent = msg;
  setTimeout(() => { statusEl.textContent = ''; }, 2500);
}

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.js');

async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += Detect.textFromPdfContent(content.items);
  }
  return text;
}

const evalStatusEl = document.getElementById('eval-status');
document.getElementById('eval-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const professorName = document.getElementById('eval-professor').value.trim();
  const courseCode = document.getElementById('eval-course').value.trim();
  const file = document.getElementById('eval-file').files[0];
  if (!professorName || !file) return;

  evalStatusEl.textContent = 'Reading PDF…';
  try {
    const text = await extractPdfText(file);
    const analyzedScore = Scoring.analyzeEvalText(text);
    chrome.runtime.sendMessage({
      type: 'ADD_COURSE_EVAL',
      professorName,
      courseCode,
      fileName: file.name,
      analyzedScore,
      textSnippet: text,
    }, () => {
      evalStatusEl.textContent = analyzedScore !== null
        ? `Imported — extracted a score of ${analyzedScore}/100 for ${professorName}.`
        : `Imported, but couldn't find a usable rating in that PDF.`;
      e.target.reset();
    });
  } catch (err) {
    evalStatusEl.textContent = `Couldn't read that PDF (${err.message || err}).`;
  }
});

(async () => {
  const name = await Storage.getSync('myName', '');
  document.getElementById('my-name').value = name;
})();

const bulkStatusEl = document.getElementById('bulk-syllabus-status');
const bulkLogEl = document.getElementById('bulk-syllabus-log');

function logLine(text) {
  const li = document.createElement('li');
  li.textContent = text;
  bulkLogEl.appendChild(li);
}

function addSyllabusMessage(professorName, courseCode, term, fileName, text) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'ADD_SYLLABUS', professorName, courseCode, term, fileName, text, submittedBy: 'bulk-import' },
      () => resolve()
    );
  });
}

document.getElementById('bulk-syllabus-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const files = Array.from(document.getElementById('bulk-syllabus-files').files);
  if (!files.length) return;

  bulkLogEl.innerHTML = '';
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    bulkStatusEl.textContent = `Processing ${i + 1} of ${files.length}: ${file.name}…`;

    let text;
    try {
      text = await extractPdfText(file);
    } catch (err) {
      logLine(`✗ ${file.name} — couldn't read PDF (${err.message || err})`);
      skipped++;
      continue;
    }

    let professor = Detect.professor(text, file.name);
    if (!professor) {
      professor = (prompt(`Couldn't find an instructor name in "${file.name}". Whose syllabus is this? (leave blank to skip)`) || '').trim();
    }
    if (!professor) {
      logLine(`✗ ${file.name} — skipped (no professor name)`);
      skipped++;
      continue;
    }

    const courseCode = Detect.courseCode(text);
    const term = Detect.term(text);
    await addSyllabusMessage(professor, courseCode, term, file.name, text);
    logLine(`✓ ${file.name} — ${professor}${courseCode ? ' / ' + courseCode : ''}${term ? ' / ' + term : ''}`);
    imported++;
  }

  bulkStatusEl.textContent = `Done — imported ${imported}, skipped ${skipped}.`;
  e.target.reset();
});

document.getElementById('save-name').addEventListener('click', async () => {
  const name = document.getElementById('my-name').value.trim();
  await Storage.setSync('myName', name);
  flash('Saved.');
});

document.getElementById('clear-cache').addEventListener('click', async () => {
  await Storage.set('rmpCache', {});
  flash('Cached ratings cleared.');
});

document.getElementById('clear-all').addEventListener('click', async () => {
  if (!confirm('This erases your schedule, friends, syllabi, and cached ratings. Continue?')) return;
  await chrome.storage.local.clear();
  await chrome.storage.sync.clear();
  flash('All data erased.');
});
