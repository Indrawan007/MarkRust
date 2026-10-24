import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuill, getEnv } from './harness.js';
import { resetImagePolicy, IMAGE_PLACEHOLDER } from '../ui/core/image-policy.js';

function paste(q, html, text = '', files = []) {
  let prevented = false;
  q.clipboard.onCapturePaste({
    defaultPrevented: false,
    preventDefault() { prevented = true; },
    clipboardData: { files, getData(type) { return type === 'text/html' ? html : type === 'text/plain' ? text : ''; } }
  });
  return prevented;
}

test('HTML paste with attached files never hands raw markup to Quill parser', () => {
  resetImagePolicy();
  const q = createQuill();
  q.setSelection(0, 0, 'silent');
  const html = '<img src="https://tracker.example/paste.png" srcset="https://tracker.example/2.png 2x" onerror="bad()">';
  const OriginalParser = globalThis.DOMParser;
  const parsed = [];
  globalThis.DOMParser = class {
    parseFromString(input, type) {
      parsed.push(input);
      return new OriginalParser().parseFromString(input, type);
    }
  };
  try {
    assert.equal(paste(q, html, '', [{ type: 'image/png' }]), true);
  } finally { globalThis.DOMParser = OriginalParser; }
  assert.ok(parsed.length > 0);
  assert.ok(!parsed.includes(html), 'raw HTML must not enter the built-in file/HTML heuristic');
  const img = q.root.querySelector('img');
  assert.equal(img.getAttribute('src'), IMAGE_PLACEHOLDER);
  assert.equal(img.getAttribute('data-mr-src'), 'https://tracker.example/paste.png');
  assert.equal(img.getAttribute('srcset'), null);
  assert.equal(img.getAttribute('onerror'), null);
});

test('rich paste replaces selection, preserves bold, and emits user change', () => {
  const q = createQuill();
  q.setText('abc\n', 'silent');
  q.setSelection(1, 1, 'silent');
  const sources = [];
  q.on('text-change', (_d, _old, source) => sources.push(source));
  paste(q, '<strong>X</strong>', 'X');
  assert.equal(q.getText(), 'aXc\n');
  assert.ok(q.getContents().ops.some((op) => op.insert === 'X' && op.attributes?.bold));
  assert.ok(sources.includes('user'));
  assert.equal(q.getSelection().index, 2);
});

test('plaintext paste still works and disabled editors ignore paste', () => {
  const q = createQuill();
  q.setSelection(0, 0, 'silent');
  assert.equal(paste(q, '', 'plain'), true);
  assert.equal(q.getText(), 'plain\n');
  q.disable();
  assert.equal(paste(q, '<b>ignored</b>', 'ignored'), false);
  assert.equal(q.getText(), 'plain\n');
});

test('plain text with attached files replaces selection instead of uploading', () => {
  const q = createQuill();
  q.setText('abc\n', 'silent');
  q.setSelection(1, 1, 'silent');
  let uploads = 0;
  q.uploader.upload = () => { uploads++; };
  assert.equal(paste(q, '', 'X', [{ type: 'image/png' }]), true);
  assert.equal(q.getText(), 'aXc\n');
  assert.equal(uploads, 0);
  assert.equal(q.getSelection().index, 2);
});
