import { formatSavedAt } from './drafts.js';

const activePickers = new WeakMap();

// One picker per dialog. Cancellation never selects or deletes a recovery.
export function pickRecovery(document, rows) {
  const dialog = document.getElementById('recovery-dialog');
  if (activePickers.has(dialog)) return activePickers.get(dialog);
  if (dialog.open) return Promise.resolve(null);
  const list = document.getElementById('recovery-list');
  const previousFocus = document.activeElement;
  const cleanups = [];
  let settle;
  let done = false;
  const result = new Promise((resolve) => { settle = resolve; });
  activePickers.set(dialog, result);
  function listen(node, name, handler) {
    node.addEventListener(name, handler);
    cleanups.push(() => node.removeEventListener(name, handler));
  }
  function finish(id) {
    if (done) return;
    done = true;
    cleanups.forEach((cleanup) => cleanup());
    activePickers.delete(dialog);
    if (dialog.open) dialog.close();
    if (previousFocus?.isConnected) previousFocus.focus();
    settle(id);
  }
  list.replaceChildren();
  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = row.corrupt
      ? 'Cadangan tidak dapat dibaca — berkas tetap disimpan (' + row.id + ')'
      : (row.path || 'Tanpa Judul') + ' — ' + formatSavedAt(row.savedAt);
    button.disabled = Boolean(row.corrupt);
    listen(button, 'click', () => finish(row.id));
    list.appendChild(button);
  }
  listen(dialog, 'cancel', (event) => { event.preventDefault(); finish(null); });
  // A previously queued close event must not cancel a newly opened picker.
  listen(dialog, 'close', () => { if (!dialog.open) finish(null); });
  try { dialog.showModal(); } catch { finish(null); }
  return result;
}
