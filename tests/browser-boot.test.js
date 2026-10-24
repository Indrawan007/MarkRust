import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installGlobals, readVendor } from './harness.js';
import { DRAFT_KEY } from '../ui/core/drafts.js';
import { BROWSER_SESSION_PREFIX } from '../ui/core/browser-recovery.js';

const html = readVendor('ui/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://markrust.test' });
const window = installGlobals(dom.window);
window.eval(readVendor('ui/vendor/quill/quill.js'));
window.eval(readVendor('ui/vendor/marked/marked.umd.js'));
window.confirm = () => false;
const original = JSON.stringify({ version: 1, markdown: 'Draf browser lama\n', savedAt: 1 });
window.localStorage.setItem(DRAFT_KEY, original);
await import('../ui/app.js');
await new Promise((resolve) => setTimeout(resolve, 0));
const api = window.MarkRust;

test('browser boot defers legacy; editing, saving and importing use a separate workspace', async () => {
  const storage = window.localStorage;
  assert.equal(storage.getItem(DRAFT_KEY), original);
  assert.match(window.document.getElementById('file-feedback').textContent, /ditunda/);
  window.confirm = () => true;
  await api.newDocument();
  api.quill.insertText(0, 'Kerja browser baru', 'user');
  assert.equal(await api.flushDraft(), true);
  const sessionKeys = Object.keys(storage).filter((key) => key.startsWith(BROWSER_SESSION_PREFIX));
  assert.equal(sessionKeys.length, 1);
  assert.match(storage.getItem(sessionKeys[0]), /Kerja browser baru/);
  assert.equal(storage.getItem(DRAFT_KEY), original);
  const create = URL.createObjectURL;
  const click = window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = () => 'blob:test-download';
  window.HTMLAnchorElement.prototype.click = () => {};
  try {
    assert.equal(await api.saveDocument(false), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.getItem(sessionKeys[0]), null);
    assert.equal(storage.getItem(DRAFT_KEY), original);
    assert.equal(await api.restoreDraftIfAny(), true);
    assert.match(api.getMarkdown(), /Draf browser lama/);
    assert.equal(api.getPath(), null);
    assert.equal(api.isDirty(), true);
    assert.equal(await api.flushDraft(), true);
    assert.equal(storage.getItem(DRAFT_KEY), original);
    api.discardDraft();
  } finally {
    URL.createObjectURL = create;
    window.HTMLAnchorElement.prototype.click = click;
    // Avoid a scheduled backup reviving the test workspace after completion.
    api.markClean();
  }
});

test('browser archive export downloads a copy without changing dirty editor or legacy bytes', async () => {
  api.quill.insertText(0, 'Aktif ', 'user');
  const before = api.getMarkdown();
  const dialog = window.document.getElementById('recovery-dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  const create = URL.createObjectURL;
  const click = window.HTMLAnchorElement.prototype.click;
  let blob;
  URL.createObjectURL = (value) => { blob = value; return 'blob:test-export'; };
  window.HTMLAnchorElement.prototype.click = () => {};
  try {
    const exporting = api.exportRecoveryArchive();
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.document.querySelector('#recovery-list button').click();
    assert.equal(await exporting, true);
    assert.equal(await blob.text(), 'Draf browser lama\n');
    assert.equal(api.getMarkdown(), before);
    assert.equal(api.isDirty(), true);
    assert.equal(window.localStorage.getItem(DRAFT_KEY), original);
    assert.match(window.document.getElementById('file-feedback').textContent, /Unduhan.*dimulai/);
  } finally {
    URL.createObjectURL = create;
    window.HTMLAnchorElement.prototype.click = click;
    api.discardDraft(); api.markClean();
  }
});
