import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  basename, isMarkdownFilename, titleFor, openWithTauri, saveWithTauri,
  readBrowserFile, MAX_DOCUMENT_BYTES,
  confirmDiscard, confirmSaveOnClose, confirmRestore,
  MARKDOWN_FILTERS, DEFAULT_FILENAME, ALLOWED_EXTENSIONS
} from '../ui/core/files.js';

function fakeTauri(opts = {}) {
  const calls = [];
  const openResult = 'openResult' in opts ? opts.openResult : '/home/u/catatan.md';
  const saveResult = 'saveResult' in opts ? opts.saveResult : '/home/u/hasil.md';
  const bridge = {
    calls,
    core: {
      invoke: async (cmd, args) => {
        calls.push(['invoke', cmd, args]);
        return opts.invokeResult !== undefined ? opts.invokeResult : '# Dari disk\n\nIsi.\n';
      }
    },
    dialog: {
      open: async (o) => { calls.push(['open', o]); return openResult; },
      save: async (o) => { calls.push(['save', o]); return saveResult; },
      ask: async (msg) => { calls.push(['ask', msg]); return opts.askResult !== undefined ? opts.askResult : true; },
      message: async (msg, options) => { calls.push(['message', msg, options]); return opts.messageResult ?? 'Simpan'; }
    }
  };
  if (opts.withoutDialog) delete bridge.dialog;
  return bridge;
}

test('basename menangani path Unix dan Windows', () => {
  assert.equal(basename('/home/u/catatan.md'), 'catatan.md');
  assert.equal(basename('C:\\Users\\u\\catatan.md'), 'catatan.md');
  assert.equal(basename('/home/u/'), 'u');
  assert.equal(basename(''), DEFAULT_FILENAME);
});

test('isMarkdownFilename hanya menerima ekstensi teks', () => {
  assert.equal(isMarkdownFilename('a.md'), true);
  assert.equal(isMarkdownFilename('A.MARKDOWN'), true);
  assert.equal(isMarkdownFilename('a.txt'), true);
  assert.equal(isMarkdownFilename('a.png'), false);
  assert.equal(isMarkdownFilename(''), false);
});

test('titleFor menyertakan nama berkas dan penanda kotor', () => {
  assert.equal(titleFor('/home/u/catatan.md', false), 'MarkRust — catatan.md');
  assert.equal(titleFor('/home/u/catatan.md', true), 'MarkRust — catatan.md ●');
  assert.equal(titleFor(null, false), 'MarkRust — Tanpa Judul');
});

test('openWithTauri memanggil dialog lalu read_document, dan kembalikan isi', async () => {
  const t = fakeTauri();
  const result = await openWithTauri(t);
  assert.deepEqual(result, { path: '/home/u/catatan.md', contents: '# Dari disk\n\nIsi.\n' });
  assert.deepEqual(t.calls[0], ['open', {
    multiple: false, directory: false, filters: MARKDOWN_FILTERS
  }]);
  assert.deepEqual(t.calls[1], ['invoke', 'read_document', { path: '/home/u/catatan.md' }]);
});

test('openWithTauri menerima hasil dialog berbentuk array', async () => {
  const t = fakeTauri({ openResult: ['/x.md'] });
  const result = await openWithTauri(t);
  assert.equal(result.path, '/x.md');
});

test('openWithTauri mengembalikan null bila dibatalkan, tanpa invoke', async () => {
  const t = fakeTauri({ openResult: null });
  assert.equal(await openWithTauri(t), null);
  assert.equal(t.calls.length, 1);
});

test('openWithTauri menolak bila dialog tidak ada', async () => {
  await assert.rejects(() => openWithTauri(fakeTauri({ withoutDialog: true })),
    /Dialog Tauri tidak tersedia/);
});

test('saveWithTauri langsung menulis bila path sudah ada', async () => {
  const t = fakeTauri();
  const saved = await saveWithTauri(t, { path: '/home/u/lama.md', contents: 'isi' });
  assert.equal(saved, '/home/u/lama.md');
  assert.deepEqual(t.calls, [['invoke', 'write_document', { path: '/home/u/lama.md', contents: 'isi' }]]);
});

test('saveWithTauri membuka dialog bila saveAs atau belum punya path', async () => {
  const t = fakeTauri();
  const saved = await saveWithTauri(t, { path: '/home/u/lama.md', contents: 'isi', saveAs: true });
  assert.equal(saved, '/home/u/hasil.md');
  assert.deepEqual(t.calls[0], ['save', { filters: MARKDOWN_FILTERS, defaultPath: '/home/u/lama.md' }]);
  assert.deepEqual(t.calls[1], ['invoke', 'write_document', { path: '/home/u/hasil.md', contents: 'isi' }]);
});

test('saveWithTauri batal -> null, tidak ada invoke', async () => {
  const t = fakeTauri({ saveResult: null });
  assert.equal(await saveWithTauri(t, { contents: 'isi' }), null);
  assert.equal(t.calls.length, 1);
});

test('confirmDiscard memakai dialog native bila tersedia', async () => {
  const t = fakeTauri();
  assert.equal(await confirmDiscard(t), true);
  assert.equal(t.calls[0][0], 'ask');
});


// Validasi path ada di dua bahasa (Rust untuk perintah, JS untuk drag-drop).
// Kalau salah satu berubah tanpa yang lain, tes ini yang akan mengingatkan.
test('daftar ekstensi JS identik dengan validasi Rust di main.rs', () => {
  const rust = fs.readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const m = rust.match(/matches!\(ext\.as_str\(\),\s*([^)]*)\)/);
  assert.ok(m, 'pola matches!(ext.as_str(), ...) tidak ditemukan di main.rs');
  const fromRust = Array.from(m[1].matchAll(/"([a-z]+)"/g), (x) => x[1]).sort();
  assert.deepEqual(fromRust, Array.from(ALLOWED_EXTENSIONS).sort());
});


test('confirmSaveOnClose memakai dialog native bila ada', async () => {
  const t = fakeTauri();
  assert.equal(await confirmSaveOnClose(t), 'save');
  assert.match(t.calls[t.calls.length - 1][1], /Simpan sebelum keluar/);
});

test('confirmRestore memakai dialog native bila ada', async () => {
  const t = fakeTauri({ askResult: false });
  assert.equal(await confirmRestore(t, 'Pulihkan?'), false);
});

test('fallback browser: window.confirm dipakai saat Tauri tidak ada', async () => {
  const original = globalThis.window;
  const seen = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true, writable: true,
    value: { confirm: (msg) => { seen.push(msg); return true; } }
  });
  try {
    assert.equal(await confirmDiscard(null), true);
    assert.equal(await confirmSaveOnClose(null), 'save');
    assert.equal(await confirmRestore(null, 'Pulihkan?'), true);
    assert.equal(seen.length, 3);
    assert.match(seen[0], /Perubahan belum disimpan/);
    assert.match(seen[1], /Simpan sebelum keluar/);
    assert.equal(seen[2], 'Pulihkan?');
  } finally {
    if (original === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, 'window', {
      configurable: true, writable: true, value: original
    });
  }
});

test('fallback tanpa window sama sekali -> false, tidak melempar', async () => {
  const original = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true, writable: true, value: undefined
  });
  try {
    assert.equal(await confirmSaveOnClose(null), 'cancel');
  } finally {
    if (original === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, 'window', {
      configurable: true, writable: true, value: original
    });
  }
});

test('dialog filters cover every supported document extension', () => {
  assert.deepEqual(MARKDOWN_FILTERS[0].extensions, ALLOWED_EXTENSIONS);
});

test('browser file read rejects oversized input before allocating a reader and settles abort', async () => {
  const original = globalThis.FileReader;
  let reader;
  let allocations = 0;
  globalThis.FileReader = class {
    constructor() { allocations++; reader = this; }
    readAsText() {}
  };
  try {
    await assert.rejects(readBrowserFile({ name: 'large.md', size: MAX_DOCUMENT_BYTES + 1 }), /10 MiB/);
    assert.equal(allocations, 0);
    const aborted = readBrowserFile({ name: 'ok.mkd', size: MAX_DOCUMENT_BYTES });
    reader.onabort();
    await assert.rejects(aborted, /dibatalkan/);
    const loaded = readBrowserFile({ name: 'small.mdown', size: 4 });
    reader.result = 'text'; reader.onload();
    assert.deepEqual(await loaded, { path: 'small.mdown', contents: 'text' });
  } finally { globalThis.FileReader = original; }
});

test('close decision distinguishes save/discard/cancel and treats unknown results as cancel', async () => {
  for (const [result, expected] of [
    ['Simpan', 'save'], ['Yes', 'save'], ['Keluar tanpa menyimpan', 'discard'],
    ['No', 'discard'], ['Batal', 'cancel'], ['Cancel', 'cancel'], ['', 'cancel'],
    [false, 'cancel'], ['unexpected', 'cancel']
  ]) {
    const t = fakeTauri({ messageResult: result });
    assert.equal(await confirmSaveOnClose(t), expected);
    assert.deepEqual(t.calls[0][2].buttons, { yes: 'Simpan', no: 'Keluar tanpa menyimpan', cancel: 'Batal' });
  }
  assert.equal(await confirmSaveOnClose({ dialog: {} }), 'cancel');
});

test('browser close fallback requires an explicit second confirmation to discard', async () => {
  const original = globalThis.window;
  try {
    for (const [answers, expected] of [[[false, false], 'cancel'], [[false, true], 'discard'], [[true], 'save']]) {
      const remaining = [...answers];
      globalThis.window = { confirm: () => remaining.shift() };
      assert.equal(await confirmSaveOnClose(null), expected);
      assert.equal(remaining.length, 0);
    }
  } finally { globalThis.window = original; }
});
