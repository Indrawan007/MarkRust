/*
 * Smoke test aplikasi utuh: index.html + vendor + app.js di jsdom.
 * Tujuannya bukan menguji konversi (itu sudah di roundtrip.test.js), melainkan
 * memastikan wiring DOM tidak putus: elemen yang dicari app.js benar-benar ada,
 * status bar terisi, dan jembatan window.MarkRust terbentuk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installGlobals, readVendor } from './harness.js';

const html = readVendor('ui/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/'
});
const window = installGlobals(dom.window);
window.eval(readVendor('ui/vendor/quill/quill.js'));
window.eval(readVendor('ui/vendor/marked/marked.umd.js'));
// highlight.js sengaja TIDAK dimuat -> menguji cabang `if (hljs)` di app.js.

// Bridge Tauri palsu. Disuntikkan SEBELUM import app.js supaya jalur Tauri
// (bukan fallback browser) yang benar-benar diuji.
const tauriCalls = [];
const titles = [];
const asks = [];
const closeHandlers = [];
const destroyed = [];
let nativeCloseRequests = 0;
let failNativeClose = false;
let nextAskResult = true;
let nextCloseResult = undefined;
let nextDeleteResult = 'Batal';
let failArchiveDelete = false;
let pendingDownload = null;
let failWrite = false;
let pendingWrite = null;
let pendingRead = null;
let pendingAsk = null;
let recoveryContents = null;
let archivedRecoveries = [];
let failCandidateRead = false;
let failAsk = false;
let failRecovery = false;
let pendingRecoveryWrite = null;
let failRecoveryClear = false;
const diskDocuments = new Map();
const DISK_DOC = '# Dokumen Dari Disk\n\nIsi dari berkas.\n';
window.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      tauriCalls.push([cmd, args]);
      if (cmd === 'download_image') {
        if (pendingDownload) await pendingDownload;
        return 'data:image/png;base64,AAAA';
      }
      if (cmd === 'write_recovery') {
        if (pendingRecoveryWrite) await pendingRecoveryWrite;
        if (failRecovery) throw new Error('disk full');
        recoveryContents = args.contents;
        return;
      }
      if (cmd === 'list_recoveries') return JSON.stringify(archivedRecoveries.map(({ raw, ...row }) => row));
      if (cmd === 'delete_recovery') {
        if (failArchiveDelete) throw new Error('archive locked');
        archivedRecoveries = archivedRecoveries.filter((row) => row.id !== args.id);
        return;
      }
      if (cmd === 'select_recovery') {
        if (failCandidateRead) throw new Error('recovery unavailable');
        return archivedRecoveries.find((row) => row.id === args.id)?.raw || null;
      }
      if (cmd === 'read_recovery') return recoveryContents;
      if (cmd === 'clear_recovery') {
        if (failRecoveryClear) throw new Error('cleanup failed');
        recoveryContents = null; return;
      }
      if (cmd === 'read_document' && pendingRead) await pendingRead;
      if (cmd === 'write_document' && pendingWrite) await pendingWrite;
      if (cmd === 'write_document' && failWrite) throw new Error('disk penuh');
      if (cmd === 'write_document') diskDocuments.set(args.path, args.contents);
      return cmd === 'read_document' ? (diskDocuments.get(args.path) ?? DISK_DOC) : null;
    }
  },
  dialog: {
    open: async () => '/home/u/catatan.md',
    save: async () => '/home/u/catatan-baru.md',
    ask: async (msg) => { asks.push(msg); if (failAsk) throw new Error('dialog unavailable'); if (pendingAsk) await pendingAsk; return nextAskResult; },
    message: async (msg, options) => {
      if (!options?.buttons) return;
      asks.push(msg);
      if (failAsk) throw new Error('dialog unavailable');
      if (pendingAsk) await pendingAsk;
      if (options.buttons.ok) return nextDeleteResult;
      return nextCloseResult !== undefined ? nextCloseResult
        : nextAskResult ? options.buttons.yes : options.buttons.no;
    }
  },
  event: { listen: async () => () => {} },
  window: {
    getCurrentWindow: () => ({
      setTitle: async (t) => { titles.push(t); },
      onCloseRequested: async (fn) => { closeHandlers.push(fn); return () => {}; },
      close: async () => {
        nativeCloseRequests++;
        if (failNativeClose) throw new Error('close denied');
        let prevented = false;
        await closeHandlers.at(-1)?.({ preventDefault() { prevented = true; } });
        if (!prevented) destroyed.push(true);
      },
      destroy: async () => { destroyed.push(true); }
    })
  }
};

await import('../ui/app.js');

const api = window.MarkRust;

test('app.js boot tanpa error dan mengekspos window.MarkRust', () => {
  assert.ok(api, 'window.MarkRust harus ada');
  assert.equal(typeof api.quillToMarkdown, 'function');
  assert.equal(typeof api.setMode, 'function');
  assert.equal(typeof api.setMarkdown, 'function');
  assert.equal(typeof api.getMarkdown, 'function');
  assert.equal(typeof api.getStats, 'function');
});

test('index.html menyediakan semua elemen yang dipakai status bar & dialog', () => {
  const d = window.document;
  for (const id of [
    'editor', 'editor-wrap', 'raw-view', 'raw-textarea',
    'toolbar', 'quill-toolbar', 'btn-wysiwyg', 'btn-markdown', 'btn-pin',
    'statusbar', 'sb-mode', 'sb-dirty', 'sb-notice', 'stat-words', 'stat-chars',
    'image-dialog', 'image-form', 'image-url', 'image-error', 'image-cancel', 'image-ok',
    'btn-new', 'btn-open', 'btn-save', 'sb-file', 'sb-load-images'
  ]) {
    assert.ok(d.getElementById(id), 'elemen #' + id + ' hilang dari index.html');
  }
});

test('tidak ada lagi #wordcount mengambang', () => {
  assert.equal(window.document.getElementById('wordcount'), null);
  const css = readVendor('ui/app.css');
  assert.ok(!css.includes('#wordcount'), 'CSS lama masih menyisakan #wordcount');
  assert.ok(css.includes('#statusbar'));
});

test('app.css dimuat sebagai stylesheet terpisah, bukan inline', () => {
  assert.ok(html.includes('href="app.css"'));
  assert.ok(!html.includes('<style>'));
});

test('toolbar tidak lagi memakai -webkit-app-region (decorations native aktif)', () => {
  assert.ok(!readVendor('ui/app.css').includes('-webkit-app-region'));
});

test('status bar terisi angka, bukan 0', () => {
  const stats = api.getStats();
  assert.ok(stats.words > 0, 'konten awal harus punya kata');
  assert.match(window.document.getElementById('stat-words').textContent, /^Words: \d+$/);
  assert.match(window.document.getElementById('stat-chars').textContent, /^Chars: \d+$/);
  assert.equal(window.document.getElementById('sb-mode').textContent, 'WYSIWYG');
});

test('toolbar default pinned/tampil dan dokumen awal tidak ditandai kotor', () => {
  assert.equal(api.isToolbarPinned(), true);
  assert.equal(api.isToolbarVisible(), true);
  assert.equal(api.isDirty(), false);
  assert.equal(window.document.getElementById('sb-dirty').dataset.state, 'unsaved');
});

test('ganti mode mengubah label status bar dan isi tetap round-trip', () => {
  const before = api.getMarkdown();
  api.setMode('markdown');
  assert.equal(window.document.getElementById('sb-mode').textContent, 'Markdown');
  assert.equal(window.document.getElementById('raw-textarea').value, before);
  api.setMode('wysiwyg');
  assert.equal(window.document.getElementById('sb-mode').textContent, 'WYSIWYG');
  assert.equal(api.getMarkdown(), before);
});

test('notifikasi gambar jarak jauh muncul hanya bila ada URL remote', () => {
  const notice = window.document.getElementById('sb-notice');
  assert.equal(notice.hidden, true, 'konten awal tidak boleh punya gambar remote');

  api.setMarkdown('![foto](https://contoh.test/foto.png)\n');
  api.setMode('markdown');
  api.setMode('wysiwyg');
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /1 gambar jarak jauh/);
});

test('setMarkdown lewat jembatan tidak menandai dokumen kotor', () => {
  api.markClean();
  api.setMarkdown('# Dokumen baru\n\nIsi.\n');
  assert.equal(api.isDirty(), false);
  assert.ok(api.getMarkdown().includes('Dokumen baru'));
});


test('judul awal memakai "Tanpa Judul" lewat jembatan Tauri', async () => {
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(titles.length > 0, 'setTitle harus dipanggil');
  assert.equal(titles[titles.length - 1], 'MarkRust — Tanpa Judul');
  assert.equal(window.document.getElementById('sb-file').textContent, 'Tanpa Judul');
});

test('menu native: buka berkas memanggil read_document dan mengisi editor', async () => {
  const ok = await api.handleMenuAction('open');
  assert.equal(ok, true);
  assert.equal(api.getPath(), '/home/u/catatan.md');
  assert.ok(api.getMarkdown().includes('Dokumen Dari Disk'));
  assert.ok(tauriCalls.some((c) => c[0] === 'read_document'));
  assert.equal(api.isDirty(), false);
  assert.equal(window.document.getElementById('sb-file').textContent, 'catatan.md');
});

test('menu native: simpan memanggil write_document dan membersihkan penanda kotor', async () => {
  const before = tauriCalls.length;
  const ok = await api.saveDocument(false);
  assert.equal(ok, true);
  const write = tauriCalls.slice(before).find((c) => c[0] === 'write_document');
  assert.ok(write, 'write_document harus dipanggil');
  assert.equal(write[1].path, '/home/u/catatan.md');
  assert.equal(write[1].contents, api.getMarkdown());
  assert.equal(api.isDirty(), false);
});

test('Simpan Sebagai memakai path baru dari dialog', async () => {
  const ok = await api.saveDocument(true);
  assert.equal(ok, true);
  assert.equal(api.getPath(), '/home/u/catatan-baru.md');
  assert.ok(tauriCalls.some((c) => c[0] === 'write_document' && c[1].path === '/home/u/catatan-baru.md'));
});

test('judul jendela berubah saat ada path dan saat dokumen kotor', async () => {
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(titles.includes('MarkRust — catatan-baru.md'));
  // Suntingan bersumber 'user' harus menaikkan penanda kotor.
  api.quill.insertText(0, 'X', 'user');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(api.isDirty(), true);
  assert.equal(titles[titles.length - 1], 'MarkRust — catatan-baru.md ●');
  assert.equal(window.document.getElementById('sb-dirty').hidden, false);
});

test('Ctrl+S memicu simpan lewat handler keyboard', async () => {
  const before = tauriCalls.filter((c) => c[0] === 'write_document').length;
  const ev = new window.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
  window.document.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 0));
  const after = tauriCalls.filter((c) => c[0] === 'write_document').length;
  assert.equal(after, before + 1);
  assert.equal(ev.defaultPrevented, true);
});

test('menu native: toggle_mode berpindah mode dan kembali', async () => {
  const start = window.document.getElementById('sb-mode').textContent;
  await api.handleMenuAction('toggle_mode');
  assert.notEqual(window.document.getElementById('sb-mode').textContent, start);
  await api.handleMenuAction('toggle_mode');
  assert.equal(window.document.getElementById('sb-mode').textContent, start);
});

test('dokumen baru mengosongkan path, isi, dan penanda kotor', async () => {
  const ok = await api.newDocument();
  assert.equal(ok, true);
  assert.equal(api.getPath(), null);
  assert.equal(api.getMarkdown().trim(), '');
  assert.equal(api.isDirty(), false);
  assert.equal(window.document.getElementById('sb-file').textContent, 'Tanpa Judul');
});


/* ------------------------------------------------------------------------- *
 * Draft recovery & konfirmasi tutup
 * ------------------------------------------------------------------------- */

test('handler close native terdaftar saat boot', () => {
  assert.equal(api.isCloseHandlerRegistered(), true);
  assert.ok(closeHandlers.length >= 1);
});

test('tutup saat dokumen bersih tidak memunculkan dialog', async () => {
  nextAskResult = true;
  await api.newDocument();                 // dokumen kosong & bersih
  const before = asks.length;
  const fakeEvent = { preventDefault: () => { throw new Error('tidak boleh dicegah'); } };
  await closeHandlers[closeHandlers.length - 1](fakeEvent);
  assert.equal(asks.length, before, 'tidak boleh bertanya saat tidak ada perubahan');
});

test('tutup saat kotor + pilih simpan -> write_document dipanggil, close diteruskan', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'A', 'user');
  assert.equal(api.isDirty(), true);

  nextAskResult = true;
  let prevented = false;
  const before = asks.length;
  const writesBefore = tauriCalls.filter((c) => c[0] === 'write_document').length;
  await closeHandlers[closeHandlers.length - 1]({ preventDefault: () => { prevented = true; } });

  assert.ok(asks.length > before, 'harus menanyakan konfirmasi');
  assert.match(asks[asks.length - 1], /Simpan sebelum keluar/);
  assert.equal(tauriCalls.filter((c) => c[0] === 'write_document').length, writesBefore + 1);
  assert.equal(prevented, false, 'close boleh dilanjutkan setelah simpan berhasil');
  assert.equal(api.isDirty(), false);
});

test('tutup saat kotor + pilih tidak menyimpan -> draf tetap ada untuk dipulihkan', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Teks penting', 'user');
  const expected = api.getMarkdown();

  nextAskResult = false;
  let prevented = false;
  const writesBefore = tauriCalls.filter((c) => c[0] === 'write_document').length;
  await closeHandlers[closeHandlers.length - 1]({ preventDefault: () => { prevented = true; } });

  assert.equal(tauriCalls.filter((c) => c[0] === 'write_document').length, writesBefore,
    'tidak boleh menulis berkas bila pengguna memilih keluar tanpa menyimpan');
  assert.equal(prevented, false);
  const raw = recoveryContents;
  assert.ok(raw, 'draf harus sudah ditulis sebelum dialog');
  assert.equal(JSON.parse(raw).markdown, expected);
});

test('gagal menyimpan saat mau keluar -> close dicegah, data tidak hilang', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Jangan hilang', 'user');

  failWrite = true;
  nextAskResult = true;
  let prevented = false;
  try {
    await closeHandlers[closeHandlers.length - 1]({ preventDefault: () => { prevented = true; } });
  } finally {
    failWrite = false;
  }
  assert.equal(prevented, true, 'jendela harus tetap terbuka bila simpan gagal');
  assert.equal(api.isDirty(), true);
  assert.ok(JSON.parse(recoveryContents).markdown.includes('Jangan hilang'));
});

test('draf dari sesi sebelumnya ditawarkan dan dipulihkan', async () => {
  await api.newDocument();
  const savedAt = Date.now() - 60000;
  await new Promise((r) => setTimeout(r, 0));
  window.localStorage.setItem(api.draftKey, JSON.stringify({
    version: 1, markdown: '# Pulihkan saya\n\nIsi draf.\n',
    path: '/home/u/draf.md', savedAt
  }));

  nextAskResult = true;
  const before = asks.length;
  const ok = await api.restoreDraftIfAny();

  assert.equal(ok, true);
  assert.ok(asks.length > before);
  assert.match(asks[asks.length - 1], /Ditemukan draf/);
  assert.ok(api.getMarkdown().includes('Pulihkan saya'));
  assert.equal(api.getPath(), null, 'restore imports a copy rather than a writable source path');
  assert.equal(api.isDirty(), true, 'hasil pemulihan masih harus dianggap belum tersimpan');
  window.localStorage.removeItem(api.draftKey);
});

test('menolak pemulihan draf menundanya tanpa menghapus cadangan', async () => {
  await api.newDocument();
  await new Promise((r) => setTimeout(r, 0));
  window.localStorage.setItem(api.draftKey, JSON.stringify({
    version: 1, markdown: '# Draf lama\n', path: null, savedAt: Date.now()
  }));

  nextAskResult = false;
  const ok = await api.restoreDraftIfAny();

  assert.equal(ok, false);
  assert.match(window.localStorage.getItem(api.draftKey), /Draf lama/);
  assert.ok(!api.getMarkdown().includes('Draf lama'));
  window.localStorage.removeItem(api.draftKey);
});

test('simpan berhasil menghapus draf yang tersisa', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Akan disimpan', 'user');
  await api.flushDraft();
  assert.ok(recoveryContents, 'draf native harus ada sebelum simpan');

  assert.equal(await api.saveDocument(false), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(recoveryContents, null, 'workspace native dibersihkan setelah simpan');
});


/* ------------------------------------------------------------------------- *
 * Keamanan gambar jarak jauh (integrasi dengan UI)
 * ------------------------------------------------------------------------- */

test('membuka dokumen asing menahan gambar dan menampilkan tombol Muat gambar', async () => {
  api.setMarkdown('![foto](https://tracker.example/pixel.png)\n');
  const imgs = Array.from(api.quill.root.querySelectorAll('img'));
  assert.equal(imgs.length, 1);
  assert.ok(!/^https?:/i.test(imgs[0].getAttribute('src') || ''),
    'src tidak boleh menunjuk ke jaringan sebelum ada izin');
  assert.equal(imgs[0].getAttribute('data-mr-src'), 'https://tracker.example/pixel.png');

  const btn = window.document.getElementById('sb-load-images');
  assert.equal(btn.hidden, false);
  assert.match(btn.textContent, /Muat gambar \(1\)/);
  assert.match(window.document.getElementById('sb-notice').textContent, /diblokir/);
});

test('Muat gambar mengembalikan src asli dan menyembunyikan tombol', async () => {
  const n = await api.loadRemoteImages();
  assert.equal(n, 1);
  const img = api.quill.root.querySelector('img');
  assert.equal(img.getAttribute('src'), 'data:image/png;base64,AAAA');
  assert.equal(window.document.getElementById('sb-load-images').hidden, true);
});

test('URL gambar tetap utuh di Markdown walau ditahan', () => {
  api.setMarkdown('![foto](https://tracker.example/pixel.png)\n');
  assert.match(api.getMarkdown(), /!\[foto\]\(https:\/\/tracker\.example\/pixel\.png\)/);
});

test('setMarkdown mereset izin gambar untuk dokumen berikutnya', async () => {
  api.setMarkdown('![foto](https://tracker.example/pixel.png)\n');
  await api.loadRemoteImages();
  assert.equal(api.quill.root.querySelector('img').getAttribute('src'),
    'data:image/png;base64,AAAA');

  api.setMarkdown('![baru](https://tracker.example/lain.png)\n');
  const img = api.quill.root.querySelector('img');
  assert.ok(!/^https?:/i.test(img.getAttribute('src') || ''),
    'dokumen baru harus kembali diblokir');
  assert.equal(window.document.getElementById('sb-load-images').hidden, false);
});


test('draf diperbarui juga setelah ketikan kedua saat dokumen masih kotor', async () => {
  nextAskResult = true;
  await api.newDocument();
  api.quill.insertText(0, 'Pertama', 'user');
  await new Promise((r) => setTimeout(r, 800));
  const first = JSON.parse(recoveryContents).markdown;
  api.quill.insertText(0, 'Kedua ', 'user');
  await new Promise((r) => setTimeout(r, 800));
  const second = JSON.parse(recoveryContents).markdown;
  assert.notEqual(first, second);
  assert.equal(second, api.getMarkdown());
});

test('ketikan selama simpan berlangsung tetap kotor dan dicadangkan', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Snapshot', 'user');
  let release;
  pendingWrite = new Promise((r) => { release = r; });
  try {
    const saving = api.saveDocument(false);
    await new Promise((r) => setTimeout(r, 0));
    api.quill.insertText(0, 'Baru ', 'user');
    assert.equal(await api.saveDocument(false), false, 'simpan paralel ditolak');
    release();
    assert.equal(await saving, false, 'snapshot lama bukan seluruh perubahan terbaru');
    assert.equal(api.isDirty(), true);
    assert.equal(JSON.parse(recoveryContents).markdown, api.getMarkdown());
  } finally { release(); pendingWrite = null; }
});

test('hasil simpan lama tidak mengubah path atau dirty dokumen baru', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Dokumen lama', 'user');
  let release;
  pendingWrite = new Promise((r) => { release = r; });
  try {
    const saving = api.saveDocument(false);
    await new Promise((r) => setTimeout(r, 0));
    await api.newDocument();
    api.quill.insertText(0, 'Dokumen baru', 'user');
    release();
    assert.equal(await saving, false);
    assert.equal(api.getPath(), null);
    assert.equal(api.isDirty(), true);
    assert.match(api.getMarkdown(), /Dokumen baru/);
  } finally { release(); pendingWrite = null; }
});


test('quota gagal terlihat; tutup tanpa simpan dicegah dan bisa pulih', async () => {
  nextAskResult = true;
  await api.newDocument();
  api.quill.insertText(0, 'Jangan hilang karena quota', 'user');
  const proto = Object.getPrototypeOf(window.localStorage);
  const original = proto.setItem;
  try {
    failRecovery = true;
    assert.equal(await api.flushDraft(), false);
    assert.equal(window.document.getElementById('sb-draft-error').hidden, false);
    nextAskResult = false;
    let prevented = false;
    await closeHandlers.at(-1)({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(api.isDirty(), true);
  } finally {
    proto.setItem = original;
    failRecovery = false;
    nextAskResult = true;
  }
  assert.equal(await api.flushDraft(), true);
  assert.equal(window.document.getElementById('sb-draft-error').hidden, true);
});

test('mengetik berkelanjutan tetap mencadangkan sebelum berhenti', async () => {
  await api.newDocument();
  for (let i = 0; i < 8; i++) {
    api.quill.insertText(0, String(i), 'user');
    await new Promise((r) => setTimeout(r, 450));
  }
  const draft = JSON.parse(recoveryContents);
  assert.ok(draft, 'batas 3 detik harus menulis sebelum debounce sepi');
  assert.ok(draft.markdown.includes('0'));
  await api.flushDraft();
  assert.equal(JSON.parse(recoveryContents).markdown, api.getMarkdown());
});


test('open yang tertunda tidak menimpa ketikan baru', async () => {
  nextAskResult = true;
  await api.newDocument();
  let release;
  pendingRead = new Promise((r) => { release = r; });
  try {
    const opening = api.openDocument();
    await new Promise((r) => setTimeout(r, 0));
    api.quill.insertText(0, 'Ketikan baru', 'user');
    release();
    assert.equal(await opening, false);
    assert.match(api.getMarkdown(), /Ketikan baru/);
    assert.equal(api.isDirty(), true);
    assert.equal(api.getPath(), null);
  } finally { release(); pendingRead = null; }
});

test('konfirmasi Baru yang tertunda tidak membuang perubahan setelah dialog dimulai', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Awal', 'user');
  let release;
  pendingAsk = new Promise((r) => { release = r; });
  try {
    const creating = api.newDocument();
    api.quill.insertText(0, 'Terbaru ', 'user');
    release();
    assert.equal(await creating, false);
    assert.match(api.getMarkdown(), /Terbaru/);
    assert.equal(api.isDirty(), true);
  } finally { release(); pendingAsk = null; }
});

test('pemulihan tidak menimpa dokumen yang sedang kotor', async () => {
  assert.equal(api.isDirty(), true);
  const before = api.getMarkdown();
  assert.equal(await api.restoreDraftIfAny(), false);
  assert.equal(api.getMarkdown(), before);
});

test('gambar baru yang dipaste setelah Muat gambar tetap memerlukan izin', async () => {
  nextAskResult = true;
  await api.newDocument();
  api.setMarkdown('![awal](https://images.example/approved.png)\n');
  await api.loadRemoteImages();
  assert.equal(api.quill.root.querySelector('img').getAttribute('src'),
    'data:image/png;base64,AAAA');
  api.quill.setSelection(api.quill.getLength() - 1, 0, 'silent');
  api.quill.clipboard.onCapturePaste({
    defaultPrevented: false,
    preventDefault() {},
    clipboardData: {
      files: [],
      getData(type) { return type === 'text/html' ? '<img src="https://tracker.example/new.png">' : ''; }
    }
  });
  const added = Array.from(api.quill.root.querySelectorAll('img'))
    .find((img) => img.getAttribute('data-mr-src') === 'https://tracker.example/new.png');
  assert.ok(added);
  assert.ok(added.getAttribute('src').startsWith('data:'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(window.document.getElementById('sb-load-images').hidden, false);
  assert.match(api.getMarkdown(), /https:\/\/tracker\.example\/new\.png/);
});

test('native image loading uses restricted command and retains Markdown URL', async () => {
  nextAskResult = true;
  await api.newDocument();
  api.setMarkdown('![native](https://images.example/native.png)\n');
  const before = tauriCalls.length;
  await api.loadRemoteImages();
  assert.ok(tauriCalls.slice(before).some(([cmd, args]) =>
    cmd === 'download_image' && args.url === 'https://images.example/native.png'));
  assert.equal(api.quill.root.querySelector('img').getAttribute('src'), 'data:image/png;base64,AAAA');
  assert.match(api.getMarkdown(), /https:\/\/images\.example\/native\.png/);
});

test('save feedback shows pending, rejects repeat and retains newer unsaved edits', async () => {
  nextAskResult = true;
  await api.newDocument();
  api.quill.insertText(0, 'Awal', 'user');
  let release;
  pendingWrite = new Promise((r) => { release = r; });
  const button = window.document.getElementById('btn-save');
  const feedback = window.document.getElementById('file-feedback');
  try {
    const saving = api.saveDocument(false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.match(feedback.textContent, /Menyimpan/);
    assert.equal(await api.saveDocument(false), false);
    api.quill.insertText(0, 'Baru ', 'user');
    release();
    assert.equal(await saving, false);
    assert.match(feedback.textContent, /perubahan baru/);
    assert.equal(feedback.dataset.kind, 'warning');
    assert.equal(api.isDirty(), true);
    assert.equal(button.disabled, false);
  } finally { release(); pendingWrite = null; }
});

test('open feedback prevents duplicate dialogs and explains discarded stale result', async () => {
  await api.newDocument();
  let release;
  pendingRead = new Promise((r) => { release = r; });
  const button = window.document.getElementById('btn-open');
  try {
    const opening = api.openDocument();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(button.disabled, true);
    assert.equal(await api.openDocument(), false);
    api.quill.insertText(0, 'Pertahankan', 'user');
    release();
    assert.equal(await opening, false);
    assert.match(window.document.getElementById('file-feedback').textContent, /Tulisanmu tetap dipertahankan/);
    assert.equal(button.disabled, false);
    assert.match(api.getMarkdown(), /Pertahankan/);
  } finally { release(); pendingRead = null; }
});

test('failed save restores controls and never claims success', async () => {
  failWrite = true;
  try {
    assert.equal(await api.saveDocument(false), false);
    const feedback = window.document.getElementById('file-feedback');
    assert.equal(feedback.dataset.kind, 'error');
    assert.match(feedback.textContent, /Gagal menyimpan/);
    assert.equal(window.document.getElementById('btn-save').disabled, false);
    assert.equal(api.isDirty(), true);
  } finally { failWrite = false; }
});

test('app dialogs block file shortcuts, native menu and direct document replacement', async () => {
  nextAskResult = true;
  await api.newDocument();
  api.quill.insertText(0, 'Tulisan aktif', 'user');
  const before = api.getMarkdown();
  for (const id of ['image-dialog', 'recovery-dialog']) {
    const dialog = window.document.getElementById(id);
    dialog.setAttribute('open', '');
    const callsBefore = tauriCalls.length;
    const modeBefore = window.document.getElementById('sb-mode').textContent;
    try {
      for (const action of ['new', 'open', 'save', 'save_as', 'toggle_mode']) {
        assert.equal(await api.handleMenuAction(action), false);
      }
      assert.equal(await api.newDocument(), false);
      assert.equal(await api.openDocument(), false);
      assert.equal(await api.saveDocument(false), false);
      for (const key of ['n', 'o', 's', 'm']) {
        const event = new window.KeyboardEvent('keydown', {
          key, ctrlKey: true, shiftKey: key === 'm', bubbles: true, cancelable: true
        });
        window.document.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
      }
      assert.equal(api.getMarkdown(), before);
      assert.equal(window.document.getElementById('sb-mode').textContent, modeBefore);
      assert.equal(tauriCalls.length, callsBefore);
    } finally { dialog.removeAttribute('open'); }
  }
});

test('held shortcut is suppressed while IME, Alt and unrelated shortcuts are left alone', () => {
  const callsBefore = tauriCalls.length;
  const held = new window.KeyboardEvent('keydown', {
    key: 's', ctrlKey: true, repeat: true, bubbles: true, cancelable: true
  });
  window.document.dispatchEvent(held);
  assert.equal(held.defaultPrevented, true);
  for (const options of [
    { key: 's', ctrlKey: true, isComposing: true },
    { key: 's', ctrlKey: true, altKey: true },
    { key: 'c', ctrlKey: true },
    { key: 'z', ctrlKey: true }
  ]) {
    const event = new window.KeyboardEvent('keydown', { ...options, bubbles: true, cancelable: true });
    window.document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(tauriCalls.length, callsBefore);
});

test('repeated New requests produce one confirmation and restore controls after cancel', async () => {
  nextAskResult = true;
  await api.newDocument();
  api.quill.insertText(0, 'Jangan buang', 'user');
  let release;
  pendingAsk = new Promise((resolve) => { release = resolve; });
  nextAskResult = false;
  const before = asks.length;
  try {
    const creating = api.newDocument();
    assert.equal(window.document.getElementById('btn-new').disabled, true);
    assert.equal(await api.newDocument(), false);
    assert.equal(await api.openDocument(), false);
    assert.equal(await api.saveDocument(false), false);
    assert.equal(asks.length, before + 1);
    release();
    assert.equal(await creating, false);
    assert.equal(window.document.getElementById('btn-new').disabled, false);
    assert.match(api.getMarkdown(), /Jangan buang/);
    assert.equal(api.isDirty(), true);
  } finally { release(); pendingAsk = null; nextAskResult = true; }
});

function mockImageDialog() {
  const dialog = window.document.getElementById('image-dialog');
  const show = dialog.showModal;
  const close = dialog.close;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  return { dialog, restore() {
    dialog.open = false;
    if (show === undefined) delete dialog.showModal; else dialog.showModal = show;
    if (close === undefined) delete dialog.close; else dialog.close = close;
  } };
}

test('image dialog Escape preserves text/selection/dirty and clears URL', async () => {
  nextAskResult = true;
  await api.newDocument();
  api.setMarkdown('abcdef\n');
  api.quill.setSelection(1, 3, 'silent');
  const before = api.getMarkdown();
  const mock = mockImageDialog();
  try {
    api.quill.getModule('toolbar').handlers.image();
    window.document.getElementById('image-url').value = 'https://example.com/private.png';
    const cancel = new window.Event('cancel', { cancelable: true });
    mock.dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(mock.dialog.open, false);
    assert.equal(api.getMarkdown(), before);
    assert.equal(api.isDirty(), false);
    assert.equal(api.quill.getSelection().index, 1);
    assert.equal(api.quill.getSelection().length, 3);
    assert.equal(window.document.getElementById('image-url').value, '');
  } finally { mock.restore(); }
});

test('image submit after document changes does not insert into the new content', async () => {
  const mock = mockImageDialog();
  try {
    api.quill.getModule('toolbar').handlers.image();
    window.document.getElementById('image-url').value = 'https://example.com/stale.png';
    api.quill.insertText(0, 'Baru ', 'user');
    const before = api.getMarkdown();
    window.document.getElementById('image-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(api.getMarkdown(), before);
    assert.equal(api.quill.root.querySelectorAll('img').length, 0);
    assert.equal(mock.dialog.open, false);
    assert.match(window.document.getElementById('file-feedback').textContent, /dokumen berubah/);
  } finally { mock.restore(); }
});

test('image Cancel and invalid URL leave document unchanged', async () => {
  await api.newDocument();
  api.setMarkdown('Tulisan\n');
  const before = api.getMarkdown();
  const mock = mockImageDialog();
  try {
    api.quill.getModule('toolbar').handlers.image();
    window.document.getElementById('image-url').value = 'javascript:alert(1)';
    window.document.getElementById('image-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(mock.dialog.open, true);
    assert.ok(window.document.getElementById('image-error').textContent);
    window.document.getElementById('image-cancel').click();
    assert.equal(mock.dialog.open, false);
    assert.equal(api.getMarkdown(), before);
    assert.equal(api.isDirty(), false);
    // A delayed submit after cancellation cannot insert an image.
    window.document.getElementById('image-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    assert.equal(api.getMarkdown(), before);
  } finally { mock.restore(); }
});

test('no-edit mode round-trip preserves Delta, visual selection, focus and undo', async () => {
  nextAskResult = true;
  api.setMode('wysiwyg');
  await api.newDocument();
  api.setMarkdown('Sebelum\n');
  api.quill.history.clear();
  api.quill.insertText(0, 'Baru ', 'user');
  api.quill.history.cutoff();
  api.quill.setSelection(2, 3, 'silent');
  const before = JSON.stringify(api.quill.getContents());
  const undoCount = api.quill.history.stack.undo.length;
  api.setMode('markdown');
  api.setMode('wysiwyg');
  assert.equal(JSON.stringify(api.quill.getContents()), before);
  assert.equal(api.quill.history.stack.undo.length, undoCount);
  assert.equal(api.quill.getSelection().index, 2);
  assert.equal(api.quill.getSelection().length, 3);
  assert.equal(window.document.activeElement, api.quill.root);
  api.quill.history.undo();
  assert.equal(api.quill.getText(), 'Sebelum\n');
  api.quill.history.redo();
  assert.equal(api.quill.getText(), 'Baru Sebelum\n');
});

test('raw edits convert as one undoable boundary without marking clean', async () => {
  await api.newDocument();
  api.setMarkdown('Sebelum\n');
  api.quill.history.clear();
  api.setMode('markdown');
  const raw = window.document.getElementById('raw-textarea');
  raw.value = '**Sesudah**\n';
  raw.dispatchEvent(new window.Event('input', { bubbles: true }));
  api.setMode('wysiwyg');
  assert.equal(api.isDirty(), true);
  assert.match(api.getMarkdown(), /\*\*Sesudah\*\*/);
  api.quill.history.undo();
  assert.equal(api.quill.getText(), 'Sebelum\n');
  api.quill.history.redo();
  assert.match(api.getMarkdown(), /\*\*Sesudah\*\*/);
});

test('raw selection is retained on unchanged revisits, clean toggles stay clean', async () => {
  await api.newDocument();
  api.setMarkdown('abcdef\n');
  api.setMode('markdown');
  const raw = window.document.getElementById('raw-textarea');
  assert.equal(window.document.activeElement, raw);
  raw.setSelectionRange(1, 4, 'backward');
  api.setMode('wysiwyg');
  api.setMode('markdown');
  assert.equal(raw.selectionStart, 1);
  assert.equal(raw.selectionEnd, 4);
  assert.equal(raw.selectionDirection, 'backward');
  assert.equal(api.isDirty(), false);
  assert.equal(window.document.getElementById('btn-markdown').getAttribute('aria-pressed'), 'true');
  api.setMode('wysiwyg');
});

test('document replacement in raw mode cannot undo back into the previous document', async () => {
  await api.newDocument();
  api.setMarkdown('Ancien\n');
  api.quill.insertText(0, 'Edit ', 'user');
  api.setMode('markdown');
  await api.newDocument();
  const raw = window.document.getElementById('raw-textarea');
  raw.value = 'Dokumen pengganti\n';
  raw.dispatchEvent(new window.Event('input', { bubbles: true }));
  api.setMode('wysiwyg');
  api.quill.history.undo();
  assert.equal(api.quill.getText(), 'Dokumen pengganti\n');
  assert.equal(api.setMode('invalid'), false);
  assert.equal(window.document.getElementById('sb-mode').textContent, 'WYSIWYG');
});


test('deferred native recovery survives editing and saving a separate workspace', async () => {
  nextAskResult = true;
  api.setMode('wysiwyg');
  await api.newDocument();
  const original = JSON.stringify({ version: 1, markdown: '# Arsip lama\n', path: '/old.md', savedAt: 1 });
  archivedRecoveries = [{ id: 'session-old', raw: original, path: '/old.md', savedAt: 1 }];
  try {
    nextAskResult = false;
    assert.equal(await api.restoreDraftIfAny(), false);
    assert.equal(archivedRecoveries[0].raw, original);
    api.quill.insertText(0, 'Pekerjaan baru', 'user');
    await api.flushDraft();
    assert.match(recoveryContents, /Pekerjaan baru/);
    assert.equal(await api.saveDocument(false), true);
    assert.equal(archivedRecoveries[0].raw, original);
    nextAskResult = true;
    assert.equal(await api.restoreDraftIfAny(), true);
    assert.match(api.getMarkdown(), /Arsip lama/);
    assert.equal(archivedRecoveries[0].raw, original);
  } finally { archivedRecoveries = []; nextAskResult = true; }
});

test('unreadable candidate is reported without clearing or changing current content', async () => {
  await api.newDocument();
  const before = api.getMarkdown();
  archivedRecoveries = [{ id: 'session-old', raw: 'broken', path: null }];
  failCandidateRead = true;
  try {
    assert.equal(await api.restoreDraftIfAny(), false);
    assert.equal(api.getMarkdown(), before);
    assert.equal(archivedRecoveries[0].raw, 'broken');
    assert.match(window.document.getElementById('file-feedback').textContent, /Pemulihan gagal/);
  } finally { archivedRecoveries = []; failCandidateRead = false; }
});

test('kontrol format dan input memiliki nama aksesibel', () => {
  for (const button of window.document.querySelectorAll('#quill-toolbar button')) {
    assert.ok(button.getAttribute('aria-label'), button.outerHTML);
    assert.equal(button.title, button.getAttribute('aria-label'));
  }
  assert.equal(window.document.getElementById('raw-textarea').getAttribute('aria-label'), 'Editor Markdown');
  assert.equal(window.document.getElementById('image-url').getAttribute('aria-describedby'), 'image-error');
});

test('auto-hide tidak terus ditunda oleh gerakan pointer dan seleksi keyboard menampilkan toolbar', async () => {
  await api.newDocument();
  api.setMode('wysiwyg');
  api.quill.setText('Pilih teks ini\n');
  api.quill.setSelection(0, 0);
  const doc = window.document;
  const app = doc.getElementById('app');
  const pin = doc.getElementById('btn-pin');
  const move = () => doc.dispatchEvent(new window.MouseEvent('pointermove', { clientY: 500 }));
  if (pin.getAttribute('aria-pressed') === 'true') pin.click();
  try {
    move();
    await new Promise((resolve) => setTimeout(resolve, 250));
    move();
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(app.classList.contains('tb-hidden'), true);
    api.quill.setSelection(0, 5, 'user');
    assert.equal(app.classList.contains('tb-hidden'), false);
    move();
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(app.classList.contains('tb-hidden'), false);
    doc.getElementById('btn-new').focus();
    assert.equal(app.classList.contains('tb-hidden'), false);
  } finally {
    if (pin.getAttribute('aria-pressed') !== 'true') pin.click();
    api.quill.setSelection(0, 0);
    await api.flushDraft();
  }
});

test('picker warna memiliki nama, navigasi keyboard, dan swatch tertutup keluar dari urutan Tab', async () => {
  const doc = window.document;
  const key = (node, name) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  for (const picker of doc.querySelectorAll('.ql-color-picker')) {
    const label = picker.querySelector('.ql-picker-label');
    const items = [...picker.querySelectorAll('.ql-picker-item')];
    assert.match(label.getAttribute('aria-label'), /Warna/);
    assert.ok(items.every((item) => item.tabIndex === -1 && item.getAttribute('aria-label')));
    label.focus();
    key(label, ' ');
    assert.equal(label.getAttribute('aria-expanded'), 'true');
    key(label, 'ArrowDown');
    assert.equal(doc.activeElement, items[0]);
    key(items[0], 'End');
    assert.equal(doc.activeElement, items.at(-1));
    key(items.at(-1), 'ArrowDown');
    assert.equal(doc.activeElement, items[0]);
    key(items[0], 'Escape');
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(doc.activeElement, label);
    assert.equal(label.getAttribute('aria-expanded'), 'false');
    assert.ok(items.every((item) => item.tabIndex === -1));
    key(label, 'Enter');
    doc.getElementById('btn-pin').focus();
    assert.equal(label.getAttribute('aria-expanded'), 'false');
  }
});

test('Space pada swatch menerapkan warna lewat handler Quill dan menutup picker', async () => {
  await api.newDocument();
  api.setMode('wysiwyg');
  api.quill.setText('Warna\n');
  api.quill.setSelection(0, 5);
  const doc = window.document;
  const picker = doc.querySelector('.ql-color-picker.ql-color');
  const label = picker.querySelector('.ql-picker-label');
  const swatch = picker.querySelector('[data-value="#e60000"].ql-picker-item');
  label.focus();
  label.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  swatch.focus();
  swatch.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  assert.equal(api.quill.getFormat(0, 5).color, '#e60000');
  assert.equal(label.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, label);
  assert.ok([...picker.querySelectorAll('.ql-picker-item')].every((item) => item.tabIndex === -1));
  api.quill.setSelection(0, 0);
  await api.flushDraft();
});

test('paste screenshot dan upload drop tidak membaca berkas atau menyisipkan base64', async () => {
  await api.newDocument();
  api.setMode('wysiwyg');
  api.quill.setText('Tetap\n');
  api.quill.setSelection(0, 5);
  const before = api.quill.getContents();
  const OriginalReader = window.FileReader;
  let reads = 0;
  window.FileReader = class { constructor() { reads++; throw new Error('unexpected read'); } };
  try {
    const file = new window.File(['png'], 'screenshot.png', { type: 'image/png' });
    api.quill.clipboard.onCapturePaste({
      defaultPrevented: false,
      preventDefault() {},
      clipboardData: { files: [file], getData() { return ''; } }
    });
    // Same entry point used by Quill's native drop handler; no async read starts.
    api.quill.uploader.upload({ index: 0, length: 5 }, [file]);
    api.quill.uploader.upload({ index: 0, length: 5 }, [{ type: 'image/webp' }]);
    assert.equal(reads, 0);
    assert.deepEqual(api.quill.getContents(), before);
    assert.equal(api.quill.getSelection().length, 5);
    assert.match(window.document.getElementById('file-feedback').textContent, /URL HTTPS/);
    api.setMarkdown('Dokumen berikutnya\n');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(api.getMarkdown(), 'Dokumen berikutnya\n');
  } finally {
    window.FileReader = OriginalReader;
    await api.flushDraft();
  }
});

function dispatchFileDrop(files) {
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  window.document.dispatchEvent(event);
}

test('drop mengunci Buka/Baru, menolak hasil stale, dan pulih setelah read gagal', async () => {
  await api.newDocument();
  const OriginalReader = globalThis.FileReader;
  const readers = [];
  globalThis.FileReader = class { readAsText() { readers.push(this); } };
  const file = { name: 'drop.md' };
  try {
    dispatchFileDrop([file]);
    dispatchFileDrop([file]);
    assert.equal(readers.length, 1);
    assert.equal(await api.openDocument(), false);
    assert.equal(await api.newDocument(), false);
    assert.equal(window.document.getElementById('btn-open').disabled, true);
    api.quill.insertText(0, 'Tetap', 'user');
    readers[0].result = '# Stale';
    readers[0].onload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(api.getMarkdown(), /Tetap/);
    assert.equal(window.document.getElementById('btn-open').disabled, false);
    dispatchFileDrop([file]);
    readers[1].onerror();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(window.document.getElementById('file-feedback').textContent, /Gagal membaca/);
    assert.match(api.getMarkdown(), /Tetap/);
    assert.equal(window.document.getElementById('btn-open').disabled, false);
  } finally { globalThis.FileReader = OriginalReader; await api.flushDraft(); }
});

test('drop batal/multi-file mempertahankan isi; drop native tidak memakai basename sebagai path simpan', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Awal', 'user');
  const OriginalReader = globalThis.FileReader;
  let reader;
  globalThis.FileReader = class { readAsText() { reader = this; } };
  const file = { name: 'dropped.md' };
  try {
    dispatchFileDrop([file, file]);
    assert.equal(reader, undefined);
    assert.match(window.document.getElementById('file-feedback').textContent, /satu berkas/);
    nextAskResult = false;
    dispatchFileDrop([file]);
    reader.result = '# Imported'; reader.onload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(api.getMarkdown(), /Awal/);
    nextAskResult = true;
    dispatchFileDrop([file]);
    reader.result = '# Imported'; reader.onload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(api.getMarkdown(), /Imported/);
    assert.equal(api.getPath(), null);
    assert.equal(await api.saveDocument(false), true);
    assert.equal(api.getPath(), '/home/u/catatan-baru.md');
  } finally { globalThis.FileReader = OriginalReader; nextAskResult = true; await api.flushDraft(); }
});

test('close berulang hanya satu konfirmasi dan menahan penggantian dokumen', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Tahan', 'user');
  let release;
  pendingAsk = new Promise((resolve) => { release = resolve; });
  nextAskResult = false;
  const before = asks.length;
  let duplicatePrevented = false;
  const closing = closeHandlers.at(-1)({ preventDefault() {} });
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await closeHandlers.at(-1)({ preventDefault() { duplicatePrevented = true; } });
    assert.equal(duplicatePrevented, true);
    assert.equal(asks.length, before + 1);
    assert.equal(await api.newDocument(), false);
    assert.equal(await api.openDocument(), false);
    assert.equal(await api.restoreDraftIfAny(), false);
  } finally { release(); await closing; pendingAsk = null; nextAskResult = true; }
  assert.equal(await api.newDocument(), true, 'close lock must release');
});

test('ketikan saat save-on-close tertunda membatalkan close meskipun write sukses', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Awal', 'user');
  let release;
  pendingWrite = new Promise((resolve) => { release = resolve; });
  let prevented = false;
  nextAskResult = true;
  const closing = closeHandlers.at(-1)({ preventDefault() { prevented = true; } });
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.quill.insertText(0, 'Terbaru ', 'user');
    release();
    await closing;
    assert.equal(prevented, true);
    assert.equal(api.isDirty(), true);
    assert.match(api.getMarkdown(), /Terbaru/);
    assert.match(window.document.getElementById('file-feedback').textContent, /perubahan baru/);
  } finally { release(); pendingWrite = null; await api.flushDraft(); }
});

test('drop terlalu besar atau read abort tidak mengubah isi dan melepas busy', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Pertahankan', 'user');
  const original = globalThis.FileReader;
  let reader;
  globalThis.FileReader = class { readAsText() { reader = this; } };
  try {
    dispatchFileDrop([{ name: 'large.md', size: 10 * 1024 * 1024 + 1 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(reader, undefined);
    assert.equal(window.document.getElementById('btn-open').disabled, false);
    dispatchFileDrop([{ name: 'abort.mkd', size: 4 }]);
    reader.onabort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(api.getMarkdown(), /Pertahankan/);
    assert.equal(api.isDirty(), true);
    assert.equal(window.document.getElementById('btn-open').disabled, false);
    assert.match(window.document.getElementById('file-feedback').textContent, /Gagal membaca/);
  } finally { globalThis.FileReader = original; await api.flushDraft(); }
});

test('Markdown tidak menawarkan format visual atau unduhan dari DOM Quill lama', async () => {
  await api.newDocument();
  api.setMarkdown('![lama](https://images.example/stale-mode.png)\n');
  api.setMode('markdown');
  const doc = window.document;
  const raw = doc.getElementById('raw-textarea');
  raw.value = '![baru](https://images.example/new-mode.png)\n';
  raw.dispatchEvent(new window.Event('input', { bubbles: true }));
  const before = tauriCalls.filter(([cmd]) => cmd === 'download_image').length;
  assert.equal(doc.getElementById('quill-toolbar').hidden, true);
  assert.equal(doc.getElementById('sb-load-images').hidden, true);
  assert.equal(await api.loadRemoteImages(), 0);
  api.quill.getModule('toolbar').handlers.image();
  assert.equal(doc.getElementById('image-dialog').open, false);
  assert.equal(tauriCalls.filter(([cmd]) => cmd === 'download_image').length, before);
  api.setMode('wysiwyg');
  assert.equal(doc.getElementById('quill-toolbar').hidden, false);
  assert.equal(doc.getElementById('sb-load-images').hidden, false);
  await api.loadRemoteImages();
  const urls = tauriCalls.slice().filter(([cmd]) => cmd === 'download_image').slice(before).map(([, args]) => args.url);
  assert.deepEqual(urls, ['https://images.example/new-mode.png']);
  await api.flushDraft();
});

test('pindah mode dan edit saat unduhan tertunda membuang hasil dan menghentikan sisa batch', async () => {
  await api.newDocument();
  api.setMarkdown('![satu](https://images.example/one-stale.png)\n\n![dua](https://images.example/two-stale.png)\n');
  let release;
  pendingDownload = new Promise((resolve) => { release = resolve; });
  const before = tauriCalls.filter(([cmd]) => cmd === 'download_image').length;
  const loading = api.loadRemoteImages();
  try {
    api.setMode('markdown');
    const raw = window.document.getElementById('raw-textarea');
    raw.value = 'Pengganti\n';
    raw.dispatchEvent(new window.Event('input', { bubbles: true }));
    release();
    assert.equal(await loading, 0);
    assert.equal(tauriCalls.filter(([cmd]) => cmd === 'download_image').length, before + 1);
    assert.equal(api.getMarkdown(), 'Pengganti\n');
    assert.equal(window.document.getElementById('sb-load-images').disabled, false);
    api.setMode('wysiwyg');
    assert.equal(api.quill.root.querySelector('img'), null);
  } finally { release(); pendingDownload = null; await loading; await api.flushDraft(); }
});

test('restore menahan operasi lain dan close selama konfirmasi tanpa menghapus arsip', async () => {
  await api.newDocument();
  const raw = JSON.stringify({ version: 1, markdown: 'Arsip\n', savedAt: 1 });
  archivedRecoveries = [{ id: 'session-locked', raw, savedAt: 1 }];
  let release;
  pendingAsk = new Promise((resolve) => { release = resolve; });
  nextAskResult = false;
  const restoring = api.restoreDraftIfAny();
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(await api.restoreDraftIfAny(), false);
    assert.equal(await api.newDocument(), false);
    assert.equal(await api.openDocument(), false);
    assert.equal(await api.saveDocument(false), false);
    assert.equal(api.setMode('markdown'), false);
    let prevented = false;
    await closeHandlers.at(-1)({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.ok(['new', 'open', 'save'].every((action) => window.document.getElementById('btn-' + action).disabled));
    release();
    assert.equal(await restoring, false);
    assert.equal(archivedRecoveries[0].raw, raw);
    assert.ok(['new', 'open', 'save'].every((action) => !window.document.getElementById('btn-' + action).disabled));
  } finally { release(); await restoring; pendingAsk = null; archivedRecoveries = []; nextAskResult = true; }
});

test('gagal dialog restore ditangani tanpa mengubah isi dan retry tetap bisa', async () => {
  await api.newDocument();
  const before = api.getMarkdown();
  const raw = JSON.stringify({ version: 1, markdown: 'Retry arsip\n', savedAt: 1 });
  archivedRecoveries = [{ id: 'session-retry', raw, savedAt: 1 }];
  failAsk = true;
  try {
    assert.equal(await api.restoreDraftIfAny(), false);
    assert.equal(api.getMarkdown(), before);
    assert.equal(archivedRecoveries[0].raw, raw);
    assert.match(window.document.getElementById('file-feedback').textContent, /Pemulihan gagal/);
    assert.equal(window.document.getElementById('btn-open').disabled, false);
    failAsk = false;
    assert.equal(await api.restoreDraftIfAny(), true);
    assert.match(api.getMarkdown(), /Retry arsip/);
  } finally { failAsk = false; archivedRecoveries = []; await api.flushDraft(); }
});

test('ketikan saat konfirmasi restore membuat hasil stale tanpa menimpa tulisan', async () => {
  await api.newDocument();
  archivedRecoveries = [{ id: 'session-stale-confirm', raw: JSON.stringify({ version: 1, markdown: 'Jangan timpa\n', savedAt: 1 }) }];
  let release;
  pendingAsk = new Promise((resolve) => { release = resolve; });
  nextAskResult = true;
  const restoring = api.restoreDraftIfAny();
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.quill.insertText(0, 'Ketikan saat menunggu', 'user');
    release();
    assert.equal(await restoring, false);
    assert.match(api.getMarkdown(), /Ketikan saat menunggu/);
    assert.equal(api.isDirty(), true);
    assert.equal(window.document.getElementById('btn-save').disabled, false);
  } finally { release(); await restoring; pendingAsk = null; archivedRecoveries = []; await api.flushDraft(); }
});

test('statistik bukan live region; status penting tetap live dan notice identik tidak diulang', async () => {
  const doc = window.document;
  const footer = doc.getElementById('statusbar');
  assert.equal(footer.hasAttribute('aria-live'), false);
  assert.notEqual(footer.getAttribute('role'), 'status');
  for (const id of ['sb-dirty', 'sb-draft-error', 'sb-notice', 'file-feedback']) {
    assert.equal(doc.getElementById(id).getAttribute('role'), 'status');
  }
  await api.newDocument();
  api.setMarkdown('![tertahan](https://images.example/notice.png)\n');
  const notice = doc.getElementById('sb-notice');
  assert.match(notice.textContent, /diblokir/);
  let mutations = 0;
  const observer = new window.MutationObserver((records) => { mutations += records.length; });
  observer.observe(notice, { childList: true, characterData: true, subtree: true });
  try {
    api.quill.insertText(0, 'Satu ', 'user');
    await new Promise((resolve) => setTimeout(resolve, 170));
    api.quill.insertText(0, 'Dua ', 'user');
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(mutations, 0);
    assert.equal(notice.title, notice.textContent);
  } finally { observer.disconnect(); await api.flushDraft(); }
});

test('Batal/dismiss dialog close mempertahankan jendela tanpa write dan lock dilepas', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Tetap di editor', 'user');
  const before = api.getMarkdown();
  const writes = tauriCalls.filter(([cmd]) => cmd === 'write_document').length;
  try {
    for (const result of ['Batal', 'Cancel', 'unknown']) {
      nextCloseResult = result;
      let prevented = false;
      await closeHandlers.at(-1)({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(api.getMarkdown(), before);
      assert.equal(api.isDirty(), true);
      assert.equal(tauriCalls.filter(([cmd]) => cmd === 'write_document').length, writes);
      assert.match(window.document.getElementById('file-feedback').textContent, /Keluar dibatalkan/);
    }
    nextCloseResult = 'Simpan';
    let prevented = false;
    await closeHandlers.at(-1)({ preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    assert.equal(api.isDirty(), false);
  } finally { nextCloseResult = undefined; await api.flushDraft(); }
});

test('recovery write lama yang gagal setelah save tidak menyalakan warning dokumen bersih', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Tersimpan', 'user');
  let reject;
  pendingRecoveryWrite = new Promise((_resolve, fail) => { reject = fail; });
  const flushing = api.flushDraft();
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(await api.saveDocument(false), true);
    reject(new Error('old write failed'));
    assert.equal(await flushing, false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(api.isDirty(), false);
    assert.equal(window.document.getElementById('sb-draft-error').hidden, true);
    assert.equal(window.document.getElementById('sb-draft-error').title, '');
  } finally { reject(new Error('done')); pendingRecoveryWrite = null; await flushing; }
});

test('cleanup gagal dilaporkan sebagai arsip tersisa, bukan gagal menyimpan dokumen', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Isi aman', 'user');
  await api.flushDraft();
  failRecoveryClear = true;
  try {
    assert.equal(await api.saveDocument(false), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(api.isDirty(), false);
    assert.equal(window.document.getElementById('sb-draft-error').hidden, true);
    assert.match(window.document.getElementById('file-feedback').textContent, /gagal dibersihkan/);
    assert.equal(window.document.getElementById('file-feedback').dataset.kind, 'warning');
  } finally { failRecoveryClear = false; api.discardDraft(); await new Promise((resolve) => setTimeout(resolve, 0)); }
});

test('native New/Open/Save tidak menghapus legacy recovery yang ditunda atau rusak', async () => {
  await api.newDocument();
  const storage = window.localStorage;
  const raw = JSON.stringify({ version: 1, markdown: 'Legacy tertunda\n', path: '/original.md', savedAt: 1 });
  try {
    for (const source of [raw, '{corrupt-but-preserve']) {
      storage.setItem(api.draftKey, source);
      if (source === raw) {
        nextAskResult = false;
        assert.equal(await api.restoreDraftIfAny(), false);
      }
      nextAskResult = true;
      assert.equal(await api.newDocument(), true);
      api.quill.insertText(0, 'Pekerjaan terpisah', 'user');
      await api.flushDraft();
      assert.equal(storage.getItem(api.draftKey), source);
      assert.equal(await api.saveDocument(false), true);
      assert.equal(storage.getItem(api.draftKey), source);
      assert.equal(await api.openDocument(), true);
      assert.equal(storage.getItem(api.draftKey), source);
    }
  } finally { storage.removeItem(api.draftKey); nextAskResult = true; }
});

test('restore snapshot lama meminta tujuan Save baru dan tidak menulis source path otomatis', async () => {
  await api.newDocument();
  const originalPath = '/home/u/source-newer.md';
  const raw = JSON.stringify({ version: 1, markdown: '# Older snapshot\n', path: originalPath, savedAt: 1 });
  archivedRecoveries = [{ id: 'session-copy-save', raw, path: originalPath, savedAt: 1 }];
  try {
    assert.equal(await api.restoreDraftIfAny(), true);
    assert.equal(api.getPath(), null);
    assert.equal(api.isDirty(), true);
    const before = tauriCalls.length;
    const originalSave = window.__TAURI__.dialog.save;
    let dialogs = 0;
    window.__TAURI__.dialog.save = async () => { dialogs++; return null; };
    try {
      assert.equal(await api.saveDocument(false), false);
      assert.equal(api.isDirty(), true);
      assert.equal(api.getPath(), null);
    } finally { window.__TAURI__.dialog.save = originalSave; }
    assert.equal(dialogs, 1);
    assert.equal(await api.saveDocument(false), true);
    const writes = tauriCalls.slice(before).filter(([cmd]) => cmd === 'write_document');
    assert.deepEqual(writes.map(([, args]) => args.path), ['/home/u/catatan-baru.md']);
    assert.equal(archivedRecoveries[0].raw, raw);
  } finally { archivedRecoveries = []; await api.flushDraft(); }
});

test('external edit blocks Save and save-on-close; Save As preserves external source and refreshes baseline', async () => {
  await api.newDocument();
  assert.equal(await api.openDocument(), true);
  const path = api.getPath();
  api.quill.insertText(0, 'Perubahan kita ', 'user');
  const ours = api.getMarkdown();
  diskDocuments.set(path, 'Versi aplikasi lain\n');
  const before = tauriCalls.filter(([cmd]) => cmd === 'write_document').length;
  assert.equal(await api.saveDocument(false), false);
  assert.equal(api.getPath(), path);
  assert.equal(api.isDirty(), true);
  assert.equal(api.getMarkdown(), ours);
  assert.equal(diskDocuments.get(path), 'Versi aplikasi lain\n');
  assert.match(window.document.getElementById('file-feedback').textContent, /berubah di luar MarkRust/);
  nextCloseResult = 'Simpan';
  let prevented = false;
  try {
    await closeHandlers.at(-1)({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(tauriCalls.filter(([cmd]) => cmd === 'write_document').length, before);
    assert.equal(await api.saveDocument(true), true);
    assert.notEqual(api.getPath(), path);
    assert.equal(diskDocuments.get(path), 'Versi aplikasi lain\n');
    assert.equal(diskDocuments.get(api.getPath()), ours);
    api.quill.insertText(0, 'Berikutnya ', 'user');
    assert.equal(await api.saveDocument(false), true, 'baseline advances after Save As');
    api.quill.insertText(0, 'Lagi ', 'user');
    assert.equal(await api.saveDocument(false), true, 'baseline advances after regular Save too');
  } finally { nextCloseResult = undefined; await api.flushDraft(); }
});

function mockRecoveryDialog() {
  const dialog = window.document.getElementById('recovery-dialog');
  const show = dialog.showModal;
  const close = dialog.close;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  return { dialog, restore() {
    if (dialog.open) dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
    if (show === undefined) delete dialog.showModal; else dialog.showModal = show;
    if (close === undefined) delete dialog.close; else dialog.close = close;
  } };
}

test('export arsip tidak memulihkan/mengubah dokumen kotor dan tidak membersihkan sumber', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Dokumen aktif', 'user');
  api.quill.setSelection(1, 3);
  const before = api.getMarkdown();
  const raw = JSON.stringify({ version: 1, markdown: '# Export arsip\n', savedAt: 1 });
  archivedRecoveries = [{ id: 'session-export', raw, savedAt: 1 }];
  const mock = mockRecoveryDialog();
  const exporting = api.exportRecoveryArchive();
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(window.document.getElementById('recovery-title').textContent, /diekspor/);
    assert.equal(await api.exportRecoveryArchive(), false);
    assert.equal(await api.newDocument(), false);
    window.document.querySelector('#recovery-list button').click();
    assert.equal(await exporting, true);
    assert.equal(api.getMarkdown(), before);
    assert.equal(api.isDirty(), true);
    assert.equal(api.getPath(), null);
    assert.equal(archivedRecoveries[0].raw, raw);
    assert.equal(diskDocuments.get('/home/u/catatan-baru.md'), '# Export arsip\n');
    assert.equal(window.document.getElementById('btn-archives').disabled, false);
  } finally { mock.restore(); await exporting; archivedRecoveries = []; await api.flushDraft(); }
});

test('export cancel, read/write failure and active-path rejection retain editor and archives', async () => {
  await api.newDocument();
  await api.openDocument();
  api.quill.insertText(0, 'Tetap aktif ', 'user');
  const before = api.getMarkdown();
  const path = api.getPath();
  const raw = JSON.stringify({ version: 1, markdown: 'Archive unchanged\n', savedAt: 1 });
  archivedRecoveries = [{ id: 'session-export-errors', raw, savedAt: 1 }];
  const mock = mockRecoveryDialog();
  const save = window.__TAURI__.dialog.save;
  try {
    for (const mode of ['escape', 'save-cancel', 'read-error', 'write-error', 'active-path']) {
      failCandidateRead = mode === 'read-error';
      failWrite = mode === 'write-error';
      window.__TAURI__.dialog.save = async () => mode === 'save-cancel' ? null : mode === 'active-path' ? path : '/export.md';
      const writes = tauriCalls.filter(([cmd]) => cmd === 'write_document').length;
      const exporting = api.exportRecoveryArchive();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (mode === 'escape') mock.dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
      else window.document.querySelector('#recovery-list button').click();
      assert.equal(await exporting, false);
      if (mode !== 'write-error') assert.equal(tauriCalls.filter(([cmd]) => cmd === 'write_document').length, writes);
      assert.equal(api.getMarkdown(), before);
      assert.equal(api.getPath(), path);
      assert.equal(api.isDirty(), true);
      assert.equal(archivedRecoveries[0].raw, raw);
      assert.equal(window.document.getElementById('btn-archives').disabled, false);
    }
  } finally {
    mock.restore(); archivedRecoveries = []; failCandidateRead = false; failWrite = false;
    window.__TAURI__.dialog.save = save; await api.flushDraft();
  }
});

test('archive cleanup requires explicit confirm, retains dirty editor, and handles locked archives', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Tetap di editor', 'user');
  const before = api.getMarkdown();
  const raw = 'broken but retained';
  archivedRecoveries = [{ id: 'session-cleanup', corrupt: true, raw }];
  const mock = mockRecoveryDialog();
  try {
    for (const outcome of ['escape', 'Batal', 'locked', 'Hapus permanen']) {
      nextDeleteResult = outcome === 'locked' ? 'Hapus permanen' : outcome;
      failArchiveDelete = outcome === 'locked';
      const deleting = api.deleteRecoveryArchive();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(await api.newDocument(), false);
      if (outcome === 'escape') mock.dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
      else {
        const row = window.document.querySelector('#recovery-list button');
        assert.equal(row.disabled, false, 'corrupt archive can be explicitly cleaned');
        row.click();
      }
      assert.equal(await deleting, outcome === 'Hapus permanen');
      assert.equal(archivedRecoveries.length, outcome === 'Hapus permanen' ? 0 : 1);
      assert.equal(api.getMarkdown(), before);
      assert.equal(api.isDirty(), true);
      assert.equal(api.getPath(), null);
      assert.equal(window.document.getElementById('btn-cleanup').disabled, false);
    }
  } finally { mock.restore(); archivedRecoveries = []; failArchiveDelete = false; nextDeleteResult = 'Batal'; await api.flushDraft(); }
});

test('cleanup can explicitly remove corrupt legacy without clearing native workspace', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Workspace native', 'user');
  await api.flushDraft();
  const own = recoveryContents;
  window.localStorage.setItem(api.draftKey, '{corrupt legacy');
  const mock = mockRecoveryDialog();
  nextDeleteResult = 'Hapus permanen';
  try {
    const deleting = api.deleteRecoveryArchive();
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.document.querySelector('#recovery-list button').click();
    assert.equal(await deleting, true);
    assert.equal(window.localStorage.getItem(api.draftKey), null);
    assert.equal(recoveryContents, own);
    assert.equal(api.isDirty(), true);
  } finally { mock.restore(); nextDeleteResult = 'Batal'; window.localStorage.removeItem(api.draftKey); await api.flushDraft(); }
});

test('floating status clearance grows with panel height to keep final editor lines reachable', () => {
  const panel = window.document.getElementById('statusbar');
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 144 });
  try {
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(window.document.documentElement.style.getPropertyValue('--status-clearance'), '176px');
  } finally { delete panel.offsetHeight; window.dispatchEvent(new window.Event('resize')); }
});

test('native duplicate Berkas menu is not created by the Rust entry point', () => {
  const source = readVendor('src-tauri/src/main.rs');
  assert.equal(source.includes('app.set_menu'), false);
  assert.equal(source.includes('MenuItemBuilder'), false);
  assert.equal(source.includes('markrust://menu'), false);
});

test('floating panel contains only counts and save dot, green only after save, yellow after edit/new', async () => {
  const doc = window.document;
  const panel = doc.getElementById('statusbar');
  const dot = doc.getElementById('sb-dirty');
  for (const id of ['sb-mode', 'sb-file', 'sb-draft-error', 'sb-notice', 'sb-load-images']) {
    assert.equal(panel.contains(doc.getElementById(id)), false);
  }
  await api.newDocument();
  assert.equal(dot.dataset.state, 'unsaved');
  api.quill.insertText(0, 'Uji status', 'user');
  assert.equal(await api.saveDocument(false), true);
  assert.equal(dot.dataset.state, 'saved');
  assert.equal(dot.title, 'Tersimpan');
  api.quill.insertText(0, 'Edit ', 'user');
  assert.equal(dot.dataset.state, 'unsaved');
  assert.equal(dot.title, 'Belum disimpan');
  failWrite = true;
  try {
    assert.equal(await api.saveDocument(false), false);
    assert.equal(dot.dataset.state, 'unsaved');
  } finally { failWrite = false; await api.flushDraft(); }
});

test('identical recovery flushes share in-flight/successful writes; errors and discard invalidate cache', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Deduplicate', 'user');
  let release;
  pendingRecoveryWrite = new Promise((resolve) => { release = resolve; });
  const before = tauriCalls.filter(([cmd]) => cmd === 'write_recovery').length;
  try {
    const first = api.flushDraft();
    const second = api.flushDraft();
    assert.equal(first, second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(tauriCalls.filter(([cmd]) => cmd === 'write_recovery').length, before + 1);
    release();
    assert.equal(await first, true);
    pendingRecoveryWrite = null;
    for (let i = 0; i < 20; i++) assert.equal(await api.flushDraft(), true);
    assert.equal(tauriCalls.filter(([cmd]) => cmd === 'write_recovery').length, before + 1);
    api.quill.insertText(0, 'New ', 'user');
    failRecovery = true;
    assert.equal(await api.flushDraft(), false);
    failRecovery = false;
    assert.equal(await api.flushDraft(), true);
    assert.equal(tauriCalls.filter(([cmd]) => cmd === 'write_recovery').length, before + 3);
    api.discardDraft();
    assert.equal(await api.flushDraft(), true);
    assert.equal(tauriCalls.filter(([cmd]) => cmd === 'write_recovery').length, before + 4);
  } finally { release(); pendingRecoveryWrite = null; failRecovery = false; await api.flushDraft(); }
});

test('typing during final exit-without-save backup blocks close until latest revision is safe', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Initial ', 'user');
  let releaseAsk;
  let releaseWrite;
  pendingAsk = new Promise((resolve) => { releaseAsk = resolve; });
  nextCloseResult = 'Keluar tanpa menyimpan';
  let prevented = false;
  const closing = closeHandlers.at(-1)({ preventDefault() { prevented = true; } });
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.quill.insertText(0, 'During prompt ', 'user');
    pendingRecoveryWrite = new Promise((resolve) => { releaseWrite = resolve; });
    releaseAsk();
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.quill.insertText(0, 'Latest ', 'user');
    releaseWrite();
    await closing;
    assert.equal(prevented, true);
    assert.match(api.getMarkdown(), /Latest/);
    assert.equal(api.isDirty(), true);
    assert.doesNotMatch(JSON.parse(recoveryContents).markdown, /Latest/);
    assert.match(window.document.getElementById('file-feedback').textContent, /ketikan baru saat pencadangan/);
  } finally {
    releaseAsk(); releaseWrite?.(); await closing;
    pendingAsk = null; pendingRecoveryWrite = null; nextCloseResult = undefined;
    assert.equal(await api.flushDraft(), true);
    assert.match(JSON.parse(recoveryContents).markdown, /Latest/);
  }
});

test('failed native error dialog never rejects Save or leaves busy controls stuck', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Keep content', 'user');
  const original = window.__TAURI__.dialog.message;
  window.__TAURI__.dialog.message = async () => { throw new Error('portal unavailable'); };
  failWrite = true;
  try {
    assert.equal(await api.saveDocument(false), false);
    assert.equal(api.isDirty(), true);
    assert.equal(window.document.getElementById('btn-save').disabled, false);
    assert.match(window.document.getElementById('file-feedback').textContent, /Gagal menyimpan/);
    assert.match(api.getMarkdown(), /Keep content/);
  } finally { failWrite = false; window.__TAURI__.dialog.message = original; await api.flushDraft(); }
});

test('formatting without count changes does not rewrite statistic text nodes', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Stable counts', 'user');
  await new Promise((resolve) => setTimeout(resolve, 170));
  let mutations = 0;
  const observer = new window.MutationObserver((records) => { mutations += records.length; });
  for (const id of ['stat-words', 'stat-chars']) observer.observe(window.document.getElementById(id), { childList: true, characterData: true, subtree: true });
  try {
    api.quill.formatText(0, 6, 'bold', true, 'user');
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(mutations, 0);
  } finally { observer.disconnect(); await api.flushDraft(); }
});

test('toolbar close uses guarded CloseRequested: cancel/failure retain data, clean/save may close', async () => {
  await api.newDocument();
  let closed = destroyed.length;
  assert.equal(await api.requestAppClose(), true);
  assert.equal(destroyed.length, ++closed);
  api.quill.insertText(0, 'Do not lose', 'user');
  nextCloseResult = 'Batal';
  assert.equal(await api.requestAppClose(), true, 'request was delivered, but cancellation keeps window');
  assert.equal(destroyed.length, closed);
  assert.equal(api.isDirty(), true);
  nextCloseResult = 'Simpan';
  failWrite = true;
  try {
    assert.equal(await api.requestAppClose(), true);
    assert.equal(destroyed.length, closed);
    assert.equal(api.isDirty(), true);
  } finally { failWrite = false; }
  assert.equal(await api.requestAppClose(), true);
  assert.equal(destroyed.length, closed + 1);
  assert.equal(api.isDirty(), false);
  nextCloseResult = undefined;
});

test('Ctrl+Q/button request close; repeated requests and native errors are handled', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Still here', 'user');
  let release;
  pendingAsk = new Promise((resolve) => { release = resolve; });
  nextCloseResult = 'Batal';
  const button = window.document.getElementById('btn-close');
  const before = nativeCloseRequests;
  const event = new window.KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, cancelable: true });
  window.document.dispatchEvent(event);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(event.defaultPrevented, true);
    assert.equal(button.disabled, true);
    assert.equal(await api.requestAppClose(), false);
    assert.equal(nativeCloseRequests, before + 1);
  } finally { release(); pendingAsk = null; await new Promise((resolve) => setTimeout(resolve, 0)); nextCloseResult = undefined; }
  failNativeClose = true;
  try {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(button.disabled, false);
    assert.match(window.document.getElementById('file-feedback').textContent, /Gagal meminta tutup/);
    assert.equal(api.isDirty(), true);
  } finally { failNativeClose = false; await api.flushDraft(); }
});

test('main-window capability permits close requests and Tauri guarded listener completion', () => {
  const capability = JSON.parse(readVendor('src-tauri/capabilities/default.json'));
  assert.deepEqual(capability.windows, ['main']);
  assert.ok(capability.permissions.includes('core:window:allow-close'));
  assert.ok(capability.permissions.includes('core:window:allow-destroy'));
});
