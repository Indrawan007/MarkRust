import test from 'node:test';
import assert from 'node:assert/strict';
import { protectRawMarkdown } from '../ui/core/raw-markdown.js';

test('Markdown biasa dan inline HTML yang didukung tidak dilindungi', () => {
  const source = '# Judul\n\n**Tebal**, <u>garis</u>, dan <span style="color:#ff0000">merah</span>.\n';
  assert.deepEqual(protectRawMarkdown(source), { source, blocks: [] });
});

test('HTML dan komentar di dalam fenced code tidak memicu fallback raw', () => {
  const source = '```html\n<div>contoh</div>\n<!-- komentar -->\n```\n';
  assert.deepEqual(protectRawMarkdown(source), { source, blocks: [] });
});

test('raw HTML blok dipetakan ke token tanpa membuang sumber', () => {
  const source = '<div class="kotak">konten</div>\n\nIsi\n';
  const result = protectRawMarkdown(source);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].markdown, '<div class="kotak">konten</div>');
  assert.ok(result.source.includes(result.blocks[0].token));
  assert.ok(!result.source.includes('<div'));
  assert.ok(result.source.endsWith('\n\nIsi\n'));
});

test('inline HTML yang atributnya akan hilang dilindungi sebagai satu blok', () => {
  const result = protectRawMarkdown('Tekan <kbd>Ctrl</kbd> atau <span class="x">ini</span>.\n');
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].markdown, 'Tekan <kbd>Ctrl</kbd> atau <span class="x">ini</span>.');
});

test('list dan nested blockquote dilindungi, quote paragraf tetap visual', () => {
  assert.equal(protectRawMarkdown('> - satu\n> - dua\n').blocks.length, 1);
  assert.equal(protectRawMarkdown('> luar\n> > dalam\n').blocks.length, 1);
  assert.equal(protectRawMarkdown('> paragraf **biasa**\n').blocks.length, 0);
});

test('komentar multiline dengan blank line tetap satu blok raw', () => {
  const result = protectRawMarkdown('<!-- awal\n\nakhir -->\n\nIsi\n');
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].markdown, '<!-- awal\n\nakhir -->');
  assert.ok(result.source.endsWith('\n\nIsi\n'));
});

test('token buatan tidak menimpa token yang sudah ada di dokumen', () => {
  const result = protectRawMarkdown('MARKRUSTRAWBLOCK0TOKEN\n\n<div>x</div>\n');
  assert.equal(result.blocks.length, 1);
  assert.notEqual(result.blocks[0].token, 'MARKRUSTRAWBLOCK0TOKEN');
  assert.ok(result.source.startsWith('MARKRUSTRAWBLOCK0TOKEN\n\n'));
});
