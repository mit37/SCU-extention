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
    text += content.items.map((item) => item.str).join(' ') + '\n';
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
