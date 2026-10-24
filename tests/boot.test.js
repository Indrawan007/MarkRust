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
let nextAskResult = true;
let failWrite = false;
let pendingWrite = null;
let pendingRead = null;
let pendingAsk = null;
let recoveryContents = null;
let archivedRecoveries = [];
let failCandidateRead = false;
let failRecovery = false;
const DISK_DOC = '# Dokumen Dari Disk\n\nIsi dari berkas.\n';
window.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      tauriCalls.push([cmd, args]);
      if (cmd === 'download_image') return 'data:image/png;base64,AAAA';
      if (cmd === 'write_recovery') {
        if (failRecovery) throw new Error('disk full');
        recoveryContents = args.contents;
        // Mirror for legacy assertions, not used by production disk writes.
        window.localStorage.setItem('markrust.draft.v1', args.contents);
        return;
      }
      if (cmd === 'list_recoveries') return JSON.stringify(archivedRecoveries.map(({ raw, ...row }) => row));
      if (cmd === 'select_recovery') {
        if (failCandidateRead) throw new Error('recovery unavailable');
        return archivedRecoveries.find((row) => row.id === args.id)?.raw || null;
      }
      if (cmd === 'read_recovery') return recoveryContents;
      if (cmd === 'clear_recovery') { recoveryContents = null; return; }
      if (cmd === 'read_document' && pendingRead) await pendingRead;
      if (cmd === 'write_document' && pendingWrite) await pendingWrite;
      if (cmd === 'write_document' && failWrite) throw new Error('disk penuh');
      return cmd === 'read_document' ? DISK_DOC : null;
    }
  },
  dialog: {
    open: async () => '/home/u/catatan.md',
    save: async () => '/home/u/catatan-baru.md',
    ask: async (msg) => { asks.push(msg); if (pendingAsk) await pendingAsk; return nextAskResult; },
    message: async () => {}
  },
  event: { listen: async () => () => {} },
  window: {
    getCurrentWindow: () => ({
      setTitle: async (t) => { titles.push(t); },
      onCloseRequested: async (fn) => { closeHandlers.push(fn); return () => {}; },
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
  assert.equal(window.document.getElementById('sb-dirty').hidden, true);
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
  const raw = window.localStorage.getItem(api.draftKey);
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
  assert.ok(JSON.parse(window.localStorage.getItem(api.draftKey)).markdown.includes('Jangan hilang'));
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
  assert.equal(api.getPath(), '/home/u/draf.md');
  assert.equal(api.isDirty(), true, 'hasil pemulihan masih harus dianggap belum tersimpan');
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
});

test('simpan berhasil menghapus draf yang tersisa', async () => {
  await api.newDocument();
  api.quill.insertText(0, 'Akan disimpan', 'user');
  await api.flushDraft();
  assert.ok(window.localStorage.getItem(api.draftKey), 'draf harus ada sebelum simpan');

  assert.equal(await api.saveDocument(false), true);
  assert.equal(window.localStorage.getItem(api.draftKey), null,
    'draf harus dihapus setelah berkas tersimpan');
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
  const first = JSON.parse(window.localStorage.getItem(api.draftKey)).markdown;
  api.quill.insertText(0, 'Kedua ', 'user');
  await new Promise((r) => setTimeout(r, 800));
  const second = JSON.parse(window.localStorage.getItem(api.draftKey)).markdown;
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
    assert.equal(JSON.parse(window.localStorage.getItem(api.draftKey)).markdown, api.getMarkdown());
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
  const draft = JSON.parse(window.localStorage.getItem(api.draftKey));
  assert.ok(draft, 'batas 3 detik harus menulis sebelum debounce sepi');
  assert.ok(draft.markdown.includes('0'));
  await api.flushDraft();
  assert.equal(JSON.parse(window.localStorage.getItem(api.draftKey)).markdown, api.getMarkdown());
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
