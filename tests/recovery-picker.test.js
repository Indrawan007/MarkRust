import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { pickRecovery } from '../ui/core/recovery-picker.js';

function setup() {
  const { window } = new JSDOM('<dialog id="recovery-dialog"><div id="recovery-list"></div></dialog>');
  const doc = window.document;
  const dialog = doc.querySelector('dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  return { window, doc, dialog };
}

test('picker renders path as text and returns the chosen session ID', async () => {
  const { doc, dialog } = setup();
  const picked = pickRecovery(doc, [
    { id: 'session-1', path: '<img src=x onerror=alert(1)>', savedAt: 1 },
    { id: 'session-2', path: null, savedAt: 2 }
  ]);
  assert.equal(dialog.open, true);
  assert.equal(doc.querySelector('img'), null);
  const buttons = doc.querySelectorAll('button');
  assert.match(buttons[1].textContent, /Tanpa Judul/);
  buttons[1].click();
  assert.equal(await picked, 'session-2');
  assert.equal(dialog.open, false);
});

test('cancelling resolves null and reopening has no stale close handler', async () => {
  const { doc, dialog } = setup();
  const first = pickRecovery(doc, [{ id: 'session-1' }]);
  dialog.close();
  assert.equal(await first, null);
  const second = pickRecovery(doc, [{ id: 'session-2' }]);
  doc.querySelector('button').click();
  assert.equal(await second, 'session-2');
});

test('Escape cancels once and restores focus', async () => {
  const { doc, dialog, window } = setup();
  const input = doc.createElement('input');
  doc.body.appendChild(input);
  input.focus();
  const picked = pickRecovery(doc, [{ id: 'session-1' }]);
  const event = new window.Event('cancel', { cancelable: true });
  dialog.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(await picked, null);
  assert.equal(dialog.open, false);
  assert.equal(doc.activeElement, input);
});

test('repeated picker requests share one selection without replacing rows', async () => {
  const { doc } = setup();
  const first = pickRecovery(doc, [{ id: 'session-1', path: 'first.md' }]);
  const second = pickRecovery(doc, [{ id: 'session-2', path: 'second.md' }]);
  assert.equal(first, second);
  assert.match(doc.querySelector('button').textContent, /first.md/);
  doc.querySelector('button').click();
  assert.equal(await first, 'session-1');
});

test('stale button clicks and queued close events cannot settle a reopened picker', async () => {
  const { doc, dialog, window } = setup();
  const first = pickRecovery(doc, [{ id: 'session-1' }]);
  const oldButton = doc.querySelector('button');
  oldButton.click();
  await first;
  const second = pickRecovery(doc, [{ id: 'session-2' }]);
  oldButton.click();
  dialog.dispatchEvent(new window.Event('close')); // Old queued event, new dialog still open.
  assert.equal(dialog.open, true);
  doc.querySelector('button').click();
  assert.equal(await second, 'session-2');
});

test('showModal failure resolves as cancellation and allows retry', async () => {
  const { doc, dialog } = setup();
  const show = dialog.showModal;
  dialog.showModal = () => { throw new Error('unavailable'); };
  assert.equal(await pickRecovery(doc, [{ id: 'session-1' }]), null);
  dialog.showModal = show;
  const retry = pickRecovery(doc, [{ id: 'session-2' }]);
  doc.querySelector('button').click();
  assert.equal(await retry, 'session-2');
});
