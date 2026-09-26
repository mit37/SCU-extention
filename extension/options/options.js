const statusEl = document.getElementById('status');
function flash(msg) {
  statusEl.textContent = msg;
  setTimeout(() => { statusEl.textContent = ''; }, 2500);
}

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
