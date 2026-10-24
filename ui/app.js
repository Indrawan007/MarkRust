import { createBrowserRecovery } from './core/browser-recovery.js';
import { enhanceColorPickers } from './core/color-picker.js';
import { registerSafeClipboard } from './core/safe-clipboard.js';
/*
 * MarkRust — logika UI editor.
 *
 * Konversi arah:
 *   Markdown -> WYSIWYG : marked.parse()  -> normalisasi DOM -> Quill clipboard
 *   WYSIWYG  -> Markdown: Delta Quill    -> serializeLines()
 *
 * Seluruh logika konversi ada di ./core/ (modul murni, tanpa ketergantungan
 * pada instance Quill / window), supaya bisa diuji di Node. File ini hanya
 * mengurung hal-hal yang memang butuh DOM: inisialisasi Quill, toolbar, mode,
 * dan statistik.
 */
import {
  linesFromQuill,
  serializeLines
} from './core/serialize.js';
import {
  mdToQuillHtml,
  documentStats,
  remoteImageCount,
  isValidImageUrl
} from './core/markdown.js';
import {
  registerDividerBlot, registerHrMatcher,
  registerSafeImageBlot, registerImageMatcher, revealAllowedImages
} from './core/quill-setup.js';
import {
  resetImagePolicy, allowRemoteImage, allowAllRemoteImages,
  isRemoteImageAllowed, setImageDisplaySource
} from './core/image-policy.js';
import {
  getTauriApi, openWithTauri, saveWithTauri, readBrowserFile,
  MARKDOWN_FILTERS, downloadBrowserFile, confirmDiscard, confirmSaveOnClose, confirmRestore,
  showError, setWindowTitle, basename, isMarkdownFilename, titleFor,
  DEFAULT_FILENAME
} from './core/files.js';
import { pickRecovery } from './core/recovery-picker.js';
import { createDiskRecovery } from './core/recovery.js';
import {
  readDraft, restoreMessage, DRAFT_KEY
} from './core/drafts.js';

const Quill = window.Quill;
const marked = window.marked;
const hljs = window.hljs;

if (!Quill || !marked) {
  document.body.innerHTML =
    '<p style="padding:24px;font-family:sans-serif">Gagal memuat library editor (Quill / marked).</p>';
} else {
  boot();
}

function boot() {
  // `withGlobalTauri: true` menyuntikkan API vanilla JS ke window.__TAURI__.
  // Null di browser biasa -> semua operasi berkas memakai fallback.
  const tauri = getTauriApi();

  /* =========================================================
   * 1. Blot divider — modul bersama dengan harness tes
   * ======================================================= */
  registerDividerBlot(Quill);
  // Harus sebelum `new Quill()` agar blot pengganti dipakai sejak awal.
  registerSafeImageBlot(Quill);
  registerSafeClipboard(Quill);

  /* =========================================================
   * 2. Bahasa yang tersedia untuk syntax highlighting
   * ======================================================= */
  const SYNTAX_LANGS = [
    ['plain', 'Plain'], ['bash', 'Bash'], ['c', 'C'], ['cpp', 'C++'],
    ['csharp', 'C#'], ['css', 'CSS'], ['diff', 'Diff'], ['dockerfile', 'Dockerfile'],
    ['go', 'Go'], ['http', 'HTTP'], ['ini', 'INI'], ['java', 'Java'],
    ['javascript', 'JavaScript'], ['json', 'JSON'], ['kotlin', 'Kotlin'],
    ['makefile', 'Makefile'], ['markdown', 'Markdown'], ['php', 'PHP'],
    ['python', 'Python'], ['ruby', 'Ruby'], ['rust', 'Rust'], ['scss', 'SCSS'],
    ['sql', 'SQL'], ['swift', 'Swift'], ['typescript', 'TypeScript'],
    ['xml', 'HTML/XML'], ['yaml', 'YAML']
  ].map(function (p) { return { key: p[0], label: p[1] }; });

  // highlight.js melempar error untuk bahasa yang tidak terdaftar; bungkus agar aman.
  function buildSafeHljs(base) {
    const esc = function (s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    const safe = Object.create(base);
    safe.highlight = function (code, opts) {
      const lang = opts && opts.language;
      try {
        if (lang && lang !== 'plain' && !base.getLanguage(lang)) return { value: esc(code) };
        if (lang === 'plain') return { value: esc(code) };
        return base.highlight(code, opts);
      } catch (e) {
        return { value: esc(code) };
      }
    };
    return safe;
  }

  /* =========================================================
   * 3. Inisialisasi Quill
   * ======================================================= */
  // Header berupa tombol independen (H1/H2/H3), bukan dropdown — sama seperti
  // tombol format lain. Klik pada header yang aktif mengembalikan teks normal.
  const toolbarOptions = [
    [{ header: '1' }, { header: '2' }, { header: '3' }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    ['blockquote', 'code-block'],
    ['link', 'image'],
    ['clean']
  ];

  // Gambar dimasukkan lewat URL. `data:image/` sengaja DITOLAK: base64 membuat
  // berkas .md membengkak. Dialog memakai <dialog> native, bukan window.prompt
  // yang tidak reliabel di WKWebView/Tauri (bisa gagal diam-diam di macOS).
  let pendingImageRange = null;
  let pendingImageStamp = null;
  const imageDialog = document.getElementById('image-dialog');
  const imageForm = document.getElementById('image-form');
  const imageInput = document.getElementById('image-url');
  const imageError = document.getElementById('image-error');

  function imageHandler() {
    if (currentMode !== 'wysiwyg' || closeInProgress || restoreInProgress || hasOpenAppDialog()) return;
    const range = quill.getSelection(true);
    pendingImageRange = range ? { index: range.index, length: range.length } : null;
    pendingImageStamp = documentStamp();
    imageInput.value = '';
    imageError.textContent = '';
    if (typeof imageDialog.showModal === 'function') imageDialog.showModal();
    else imageDialog.setAttribute('open', '');
    imageInput.focus();
  }

  document.getElementById('image-cancel').addEventListener('click', function () {
    closeImageDialog();
  });

  imageDialog.addEventListener('close', function () {
    if (imageDialog.open) return; // Ignore a queued close from the previous opening.
    const range = pendingImageRange;
    const stamp = pendingImageStamp;
    pendingImageRange = null;
    pendingImageStamp = null;
    imageInput.value = '';
    imageError.textContent = '';
    quill.focus();
    if (range && stamp && documentUnchanged(stamp)) {
      quill.setSelection(range.index, range.length, 'silent');
    }
  });
  imageDialog.addEventListener('cancel', function (event) {
    event.preventDefault();
    closeImageDialog();
  });
  function closeImageDialog() {
    if (typeof imageDialog.close === 'function') imageDialog.close();
    else {
      imageDialog.removeAttribute('open');
      imageDialog.dispatchEvent(new Event('close'));
    }
  }

  imageForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!imageDialog.open) return;
    if (!pendingImageStamp || !documentUnchanged(pendingImageStamp)) {
      closeImageDialog();
      fileFeedback('Gambar tidak disisipkan karena dokumen berubah. Buka dialog lagi.', 'warning');
      return;
    }
    const clean = imageInput.value.trim();
    if (!isValidImageUrl(clean)) {
      imageError.textContent = 'Gunakan alamat http:// atau https://';
      imageInput.focus();
      return;
    }
    const idx = pendingImageRange ? pendingImageRange.index
      : (quill.getSelection(true) || { index: 0 }).index;
    // URL dimasukkan sendiri lewat dialog => persetujuan eksplisit.
    if (!tauri) allowRemoteImage(clean);
    quill.insertEmbed(idx, 'image', clean, 'user');
    if (tauri) loadImageUrls([clean]);
    quill.setSelection(idx + 1, 0, 'user');
    pendingImageRange = null; // Keep the post-insert caret, not the old selection.
    closeImageDialog();
  });

  // `toolbar` sengaja dikirim sebagai ARRAY, bukan objek
  // `{ container: [...], handlers: {...} }`. Quill 2.0.3 menormalkan opsi
  // dengan `u.toolbar.constructor !== Object`; objek yang dibuat di realm
  // berbeda (mis. saat app.js dimuat sebagai ES module di luar realm skrip
  // UMD) akan dianggap bukan Object, dibungkus dua kali, dan modul toolbar
  // gagal dibuat. Array selalu aman; handler khusus dipasang setelah init.
  const modules = {
    toolbar: toolbarOptions,
    clipboard: { matchVisual: false }
  };
  if (hljs) {
    modules.syntax = { hljs: buildSafeHljs(hljs), interval: 500, languages: SYNTAX_LANGS };
  }

  const quill = new Quill('#editor', {
    modules: modules,
    theme: 'snow',
    placeholder: 'Mulai mengetik di sini... (mode WYSIWYG)'
  });

  // The default uploader asynchronously inserts FileReader data URLs for
  // paste/drop. Local image embedding is not supported: block the common
  // upload entry point before any read starts (including non-default MIME).
  quill.uploader.upload = function (_range, files) {
    if (files && files.length && !hasOpenAppDialog()) {
      fileFeedback('Gambar/berkas dari clipboard tidak disisipkan. Untuk gambar, gunakan tombol Sisipkan gambar dengan URL HTTPS.', 'warning');
    }
  };

  // Pindahkan toolbar Quill ke dalam toolbar aplikasi, lalu pasang handler
  // gambar kustom (menggantikan handler bawaan Quill yang memakai prompt).
  const toolbarModule = quill.getModule('toolbar');
  if (toolbarModule) {
    if (toolbarModule.container) {
      document.getElementById('quill-toolbar').appendChild(toolbarModule.container);
      enhanceColorPickers(toolbarModule.container);
      // Quill's icon-only controls need names beyond their SVG shapes.
      const labels = {
        bold: 'Tebal', italic: 'Miring', underline: 'Garis bawah', strike: 'Coret',
        blockquote: 'Kutipan', 'code-block': 'Blok kode', link: 'Tautan',
        image: 'Sisipkan gambar', clean: 'Hapus format'
      };
      for (const button of toolbarModule.container.querySelectorAll('button')) {
        const format = [...button.classList].find((name) => name.startsWith('ql-'))?.slice(3);
        const label = format === 'header' ? 'Judul tingkat ' + button.value
          : format === 'list' ? (button.value === 'ordered' ? 'Daftar bernomor' : 'Daftar berpoin')
          : labels[format];
        if (label) {
          button.setAttribute('aria-label', label);
          button.title = label;
        }
      }

    }
    if (typeof toolbarModule.addHandler === 'function') {
      toolbarModule.addHandler('image', imageHandler);
    }
  }

  registerHrMatcher(quill, Quill);
  registerImageMatcher(quill, Quill);

  /* =========================================================
   * 4. Konversi (delegasi ke modul murni)
   * ======================================================= */
  function toHtml(md) {
    return mdToQuillHtml(md, function (src) {
      return marked.parse(String(src || ''), { gfm: true, breaks: false, async: false });
    });
  }

  function quillToMarkdown() {
    return serializeLines(linesFromQuill(quill));
  }

  /* =========================================================
   * 5. Mode WYSIWYG <-> Markdown
   * ======================================================= */
  const editorWrap = document.getElementById('editor-wrap');
  const rawView = document.getElementById('raw-view');
  const textarea = document.getElementById('raw-textarea');
  const btnWysiwyg = document.getElementById('btn-wysiwyg');
  const btnMarkdown = document.getElementById('btn-markdown');
  const sbMode = document.getElementById('sb-mode');
  const sbDirty = document.getElementById('sb-dirty');
  const sbNotice = document.getElementById('sb-notice');
  const sbFile = document.getElementById('sb-file');
  const btnLoadImages = document.getElementById('sb-load-images');
  let currentMode = 'wysiwyg';
  let currentPath = null;
  let diskBaseline = null;
  let dirty = false;
  let documentGeneration = 0;
  let editRevision = 0;
  let saveInProgress = false;
  let openInProgress = false;
  let newInProgress = false;
  let closeInProgress = false;
  let restoreInProgress = false;

  function getCanonicalMarkdown() {
    return currentMode === 'markdown' ? textarea.value : quillToMarkdown();
  }

  function refreshTitle() {
    const name = currentPath ? basename(currentPath) : 'Tanpa Judul';
    sbFile.textContent = name;
    sbFile.title = currentPath || '';
    setWindowTitle(tauri, titleFor(currentPath, dirty));
  }

  /* ---------------------------------------------------------
   * Draft recovery
   *
   * Konfirmasi tutup tidak cukup: force-quit / crash / Cmd+Q di macOS bisa
   * melewati event close. Dokumen kotor dicadangkan ke sesi disk native atau
   * sesi localStorage browser; arsip lama diimpor sebagai salinan.
   * -------------------------------------------------------*/
  let draftStorage = null;
  try { draftStorage = window.localStorage || null; } catch (e) { draftStorage = null; }

  const recoveryStore = tauri ? createDiskRecovery(tauri) : createBrowserRecovery(draftStorage);
  const DRAFT_DEBOUNCE = 700;
  let draftTimer = null;
  let draftDeadline = null;
  let draftStatusEpoch = 0;
  const draftError = document.getElementById('sb-draft-error');

  function writeDraftNow() {
    if (!dirty) return false;
    const epoch = ++draftStatusEpoch;
    const generation = documentGeneration;
    const isCurrent = () => epoch === draftStatusEpoch && generation === documentGeneration && dirty;
    const draft = { markdown: getCanonicalMarkdown(), path: currentPath, savedAt: Date.now() };
    return recoveryStore.write(draft).then(() => {
      if (isCurrent()) {
        draftError.hidden = true;
        draftError.title = '';
      }
      return true;
    }, (err) => {
      if (isCurrent()) {
        draftError.hidden = false;
        draftError.title = String(err && err.message ? err.message : err);
      }
      return false;
    });
  }

  /** Paksa tulis draf sekarang (dipakai sebelum dialog tutup / pagehide). */
  function flushDraft() {
    clearTimeout(draftTimer);
    clearTimeout(draftDeadline);
    draftDeadline = null;
    draftTimer = null;
    return writeDraftNow();
  }

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, DRAFT_DEBOUNCE);
    // Sustained typing must not postpone recovery forever.
    if (draftDeadline === null) draftDeadline = setTimeout(flushDraft, 3000);
    for (const timer of [draftTimer, draftDeadline]) {
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
  }

  function discardDraft() {
    const epoch = ++draftStatusEpoch;
    clearTimeout(draftDeadline);
    draftDeadline = null;
    draftError.hidden = true;
    clearTimeout(draftTimer);
    draftTimer = null;
    // Clear only this workspace, never a deferred legacy/session archive.
    draftError.title = '';
    if (recoveryStore) recoveryStore.clear().catch(() => {
      if (epoch !== draftStatusEpoch) return;
      fileFeedback('Cadangan sebelumnya gagal dibersihkan; berkas recovery mungkin masih ada.', 'warning');
    });
  }

  function markDirty() {
    if (!saveInProgress && !openInProgress) fileFeedback('');
    editRevision++;
    scheduleDraftSave();
    // Dijaga supaya IPC setTitle tidak dikirim pada setiap ketikan setelah
    // dokumen sudah berstatus kotor.
    if (dirty) return;
    dirty = true;
    sbDirty.hidden = false;
    refreshTitle();
  }

  function markClean() {
    dirty = false;
    sbDirty.hidden = true;
    draftError.hidden = true;
    refreshTitle();
    // SENGATA tidak menghapus draf di sini: markClean() juga dipanggil saat
    // boot, dan itu akan menghilangkan draf sebelum sempat ditawarkan.
    // Penghapusan dilakukan eksplisit oleh aksi simpan/buang di bawah.
  }

  /* ---------------------------------------------------------
   * Toolbar auto-hide + pin
   * -------------------------------------------------------*/
  const app = document.getElementById('app');
  const toolbar = document.getElementById('toolbar');
  const btnPin = document.getElementById('btn-pin');

  const EDGE = 8;      // zona pemicu di tepi atas jendela (px)
  const SLACK = 12;    // toleransi agar toolbar tak menutup saat pointer sedikit turun
  const GRACE = 400;   // jeda sebelum turun lagi (ms)
  const PIN_KEY = 'markrust.toolbar.pinned';

  let pinned = true;
  try {
    const stored = localStorage.getItem(PIN_KEY);
    if (stored !== null) pinned = stored === '1';
  } catch (e) { pinned = true; }
  let tbFocus = false;
  let tbTimer = null;
  // 9999 = pointer belum pernah berada dekat tepi atas.
  let lastY = 9999;

  function isToolbarShown() { return !app.classList.contains('tb-hidden'); }

  // Jangan sembunyikan toolbar saat pengguna sedang memilih teks — momen itu
  // justru ketika tombol format paling dibutuhkan.
  function hasTextSelection() {
    const sel = quill.getSelection();
    return !!(sel && sel.length > 0);
  }

  function syncToolbarHeight() {
    document.documentElement.style.setProperty('--toolbar-h', toolbar.offsetHeight + 'px');
  }

  function setToolbarShown(shown) {
    clearTimeout(tbTimer);
    tbTimer = null;
    app.classList.toggle('tb-hidden', !shown);
  }

  function scheduleHide() {
    if (pinned || tbFocus || hasTextSelection() || tbTimer !== null) return;
    tbTimer = setTimeout(function () {
      tbTimer = null;
      if (pinned || tbFocus || hasTextSelection()) return;
      app.classList.add('tb-hidden');
    }, GRACE);
  }

  function onPointerMove(e) {
    if (typeof e.clientY === 'number') lastY = e.clientY;
    if (pinned || tbFocus) { app.classList.remove('tb-hidden'); return; }

    const h = toolbar.offsetHeight;
    const inZone = lastY <= EDGE || (isToolbarShown() && lastY <= h + SLACK);
    if (inZone) setToolbarShown(true);
    else scheduleHide();
  }

  document.addEventListener('pointermove', onPointerMove);

  // Aksesibilitas: Tab ke kontrol toolbar harus menampilkannya.
  toolbar.addEventListener('focusin', function () {
    tbFocus = true;
    setToolbarShown(true);
  });
  toolbar.addEventListener('focusout', function () {
    tbFocus = false;
    scheduleHide();
  });

  if (btnPin) {
    btnPin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    btnPin.addEventListener('click', function () {
      pinned = !pinned;
      btnPin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      try { localStorage.setItem(PIN_KEY, pinned ? '1' : '0'); } catch (err) { /* abaikan */ }
      if (pinned) setToolbarShown(true);
      else scheduleHide();
    });
  }

  if (pinned) {
    app.classList.remove('tb-hidden');
  } else {
    // Tampil sebentar saat dimuat supaya jelas toolbar-nya ada, lalu turun.
    setTimeout(function () {
      if (!pinned && !tbFocus && lastY > EDGE) scheduleHide();
    }, 2500);
  }

  if (window.ResizeObserver) {
    new window.ResizeObserver(syncToolbarHeight).observe(toolbar);
  } else {
    window.addEventListener('resize', syncToolbarHeight);
  }
  syncToolbarHeight();

  const statusbar = document.getElementById('statusbar');
  function syncStatusClearance() {
    document.documentElement.style.setProperty('--status-clearance', Math.max(80, statusbar.offsetHeight + 32) + 'px');
  }
  if (window.ResizeObserver) new window.ResizeObserver(syncStatusClearance).observe(statusbar);
  else window.addEventListener('resize', syncStatusClearance);
  syncStatusClearance();

  function loadMarkdownIntoQuill(md) {
    const html = toHtml(md);
    quill.setContents([{ insert: '\n' }], 'silent');
    quill.clipboard.dangerouslyPasteHTML(0, html, 'api');
    if (quill.history && quill.history.clear) quill.history.clear();
    updateStats();
  }

  let visualSelection = { index: 0, length: 0 };
  let modeSnapshot = null;
  let rawPosition = null;
  quill.on('selection-change', function (range) {
    if (range) visualSelection = { index: range.index, length: range.length };
    // Selecting by keyboard must reveal formatting too, without pointer movement.
    if (range?.length) setToolbarShown(true);
    else scheduleHide();
  });

  function setMode(mode) {
    if (!['markdown', 'wysiwyg'].includes(mode) || restoreInProgress || hasOpenAppDialog()) return false;
    if (mode === currentMode) return true;

    if (mode === 'markdown') {
      const markdown = quillToMarkdown();
      const range = quill.getSelection() || visualSelection;
      modeSnapshot = {
        generation: documentGeneration, markdown,
        range: { index: range.index, length: range.length },
        scrollTop: quill.root.scrollTop
      };
      textarea.value = markdown;
      editorWrap.style.display = 'none';
      rawView.style.display = 'flex';
      textarea.focus();
      if (rawPosition && rawPosition.generation === documentGeneration && rawPosition.text === markdown) {
        textarea.setSelectionRange(rawPosition.start, rawPosition.end, rawPosition.direction);
        textarea.scrollTop = rawPosition.scrollTop;
      } else {
        textarea.setSelectionRange(0, 0);
        textarea.scrollTop = 0;
      }
    } else {
      rawPosition = {
        generation: documentGeneration, text: textarea.value,
        start: textarea.selectionStart, end: textarea.selectionEnd,
        direction: textarea.selectionDirection, scrollTop: textarea.scrollTop
      };
      if (!modeSnapshot || modeSnapshot.generation !== documentGeneration) {
        loadMarkdownIntoQuill(textarea.value); // Replacement document: old history must not leak.
      } else if (textarea.value !== modeSnapshot.markdown) {
        // One undoable conversion boundary instead of silently clearing history.
        const delta = quill.clipboard.convert({ html: toHtml(textarea.value), text: '' });
        quill.history.cutoff();
        quill.setContents(delta, 'api');
        quill.history.cutoff();
      }
      // Unchanged Markdown: keep the existing Delta/DOM and entire undo stack.
      rawView.style.display = 'none';
      editorWrap.style.display = 'flex';
      quill.focus();
      const range = modeSnapshot?.generation === documentGeneration
        ? modeSnapshot.range : { index: 0, length: 0 };
      const index = Math.min(range.index, Math.max(0, quill.getLength() - 1));
      const length = Math.min(range.length, Math.max(0, quill.getLength() - 1 - index));
      quill.setSelection(index, length, 'silent');
      if (modeSnapshot?.generation === documentGeneration) quill.root.scrollTop = modeSnapshot.scrollTop;
    }

    currentMode = mode;
    document.getElementById('quill-toolbar').hidden = mode !== 'wysiwyg';
    btnWysiwyg.classList.toggle('active', mode === 'wysiwyg');
    btnMarkdown.classList.toggle('active', mode === 'markdown');
    btnWysiwyg.setAttribute('aria-pressed', String(mode === 'wysiwyg'));
    btnMarkdown.setAttribute('aria-pressed', String(mode === 'markdown'));
    sbMode.textContent = mode === 'wysiwyg' ? 'WYSIWYG' : 'Markdown';
    updateStats();
    return true;
  }

  btnWysiwyg.addEventListener('click', function () { setMode('wysiwyg'); });
  btnMarkdown.addEventListener('click', function () { setMode('markdown'); });

  /* =========================================================
   * 5b. Operasi berkas (Tauri + fallback browser)
   * ======================================================= */
  function toggleMode() {
    setMode(currentMode === 'wysiwyg' ? 'markdown' : 'wysiwyg');
  }

  /** Terapkan dokumen ke mode yang sedang aktif. */
  function applyDocument(md) {
    documentGeneration++;
    // Dokumen baru = kepercayaan baru. Izin gambar tidak boleh menular dari
    // dokumen sebelumnya ke dokumen yang baru dibuka.
    resetImagePolicy();
    if (currentMode === 'markdown') {
      textarea.value = md;
      updateStats();
    } else {
      loadMarkdownIntoQuill(md); // sudah memanggil updateStats()
    }
  }

  function pickBrowserFile() {
    return new Promise(function (resolve, reject) {
      if (typeof document === 'undefined') { resolve(null); return; }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = MARKDOWN_FILTERS[0].extensions.map((ext) => '.' + ext).join(',');
      input.addEventListener('cancel', function () { resolve(null); }, { once: true });
      input.addEventListener('change', function () {
        const file = input.files && input.files[0];
        if (!file) { resolve(null); return; }
        readBrowserFile(file).then(resolve, reject);
      });
      input.click();
    });
  }

  function documentStamp() { return [documentGeneration, editRevision]; }
  function documentUnchanged(stamp) {
    return stamp[0] === documentGeneration && stamp[1] === editRevision;
  }

  function hasOpenAppDialog() {
    return document.querySelector('dialog[open]') !== null;
  }

  async function newDocument() {
    if (restoreInProgress || closeInProgress || newInProgress || openInProgress || hasOpenAppDialog()) return false;
    newInProgress = true;
    fileBusy('new', true);
    const stamp = documentStamp();
    try {
      if (dirty && !(await confirmDiscard(tauri))) return false;
      if (!documentUnchanged(stamp)) return false;
      discardDraft();
      currentPath = null;
      diskBaseline = null;
      applyDocument('');
      markClean();
      fileFeedback('Dokumen baru.');
      if (currentMode === 'wysiwyg') quill.focus();
      return true;
    } catch (err) {
      fileFeedback('Dokumen baru tidak dibuat. Tulisan aktif tetap dipertahankan.', 'error');
      await showError(tauri, err && err.message ? err.message : String(err));
      return false;
    } finally {
      newInProgress = false;
      fileBusy('new', false);
    }
  }

  function fileFeedback(message, kind = 'info') {
    const node = document.getElementById('file-feedback');
    node.textContent = message;
    node.dataset.kind = kind;
    node.hidden = !message;
  }

  function fileBusy(action, busy) {
    const button = document.getElementById('btn-' + action);
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  }

  async function openDocument() {
    if (restoreInProgress || closeInProgress || openInProgress || newInProgress || hasOpenAppDialog()) return false;
    openInProgress = true;
    fileBusy('open', true);
    const stamp = documentStamp();
    try {
      if (dirty && !(await confirmDiscard(tauri))) {
        fileFeedback('Buka dibatalkan. Dokumen aktif tetap dipertahankan.');
        return false;
      }
      if (!documentUnchanged(stamp)) {
        fileFeedback('Buka dibatalkan karena dokumen berubah. Coba lagi jika masih diperlukan.', 'warning');
        return false;
      }
      fileFeedback('Memilih dan membaca berkas…');
      const result = tauri ? await openWithTauri(tauri) : await pickBrowserFile();
      if (!result) { fileFeedback('Buka dibatalkan.'); return false; }
      if (!documentUnchanged(stamp)) {
        fileFeedback('Hasil buka tidak diterapkan karena ada perubahan baru. Tulisanmu tetap dipertahankan.', 'warning');
        return false;
      }
      discardDraft();
      currentPath = result.path;
      diskBaseline = tauri ? { path: result.path, contents: result.contents } : null;
      applyDocument(result.contents);
      markClean();
      fileFeedback('Dibuka: ' + basename(result.path));
      return true;
    } catch (err) {
      fileFeedback('Gagal membuka berkas. Dokumen aktif tetap dipertahankan.', 'error');
      await showError(tauri, err && err.message ? err.message : String(err));
      return false;
    } finally {
      openInProgress = false;
      fileBusy('open', false);
    }
  }

  async function saveDocument(saveAs) {
    // Never overlap writes to the same temporary file or race save dialogs.
    if (restoreInProgress || saveInProgress || newInProgress || openInProgress || hasOpenAppDialog()) return false;
    saveInProgress = true;
    fileBusy('save', true);
    fileFeedback('Menyimpan…');
    const generation = documentGeneration;
    const revision = editRevision;
    try {
      const contents = getCanonicalMarkdown();
      let savedPath;
      if (tauri) {
        savedPath = await saveWithTauri(tauri, {
          path: currentPath, contents: contents, saveAs: !!saveAs,
          expectedContents: diskBaseline?.path === currentPath ? diskBaseline.contents : undefined
        });
      } else {
        savedPath = downloadBrowserFile(
          currentPath ? basename(currentPath) : DEFAULT_FILENAME, contents);
      }
      if (!savedPath) { fileFeedback('Simpan dibatalkan.'); return false; }
      // An old save must not rename/clean a different document opened meanwhile.
      if (generation !== documentGeneration) {
        fileFeedback('Dokumen sebelumnya tersimpan; dokumen aktif tidak diubah.');
        return false;
      }
      currentPath = savedPath;
      diskBaseline = tauri ? { path: savedPath, contents } : null;
      if (revision !== editRevision || contents !== getCanonicalMarkdown()) {
        refreshTitle();
        flushDraft(); // Preserve edits made while the disk write/dialog was pending.
        fileFeedback('Versi sebelumnya tersimpan. Masih ada perubahan baru — simpan lagi.', 'warning');
        return false; // Not all current edits are saved; close must remain blocked.
      }
      discardDraft();
      markClean();
      fileFeedback(tauri ? 'Tersimpan: ' + basename(savedPath) : 'Unduhan dimulai. Periksa hasilnya di browser.');
      return true;
    } catch (err) {
      const conflict = ['DOCUMENT_CONFLICT', 'DOCUMENT_CHECK_FAILED'].includes(err?.code);
      fileFeedback(conflict ? err.message : 'Gagal menyimpan. Perubahan belum dianggap tersimpan.', conflict ? 'warning' : 'error');
      await showError(tauri, err && err.message ? err.message : String(err));
      return false;
    } finally {
      saveInProgress = false;
      fileBusy('save', false);
    }
  }

  async function handleMenuAction(action) {
    if (hasOpenAppDialog()) return false;
    switch (action) {
      case 'new': return newDocument();
      case 'open': return openDocument();
      case 'save': return saveDocument(false);
      case 'save_as': return saveDocument(true);
      case 'toggle_mode': toggleMode(); return true;
      default: return false;
    }
  }

  document.getElementById('btn-new').addEventListener('click', newDocument);
  document.getElementById('btn-open').addEventListener('click', openDocument);
  document.getElementById('btn-save').addEventListener('click', function (e) {
    saveDocument(e.shiftKey);
  });

  // Toolbar and centralized shortcuts replace the redundant native file menu.
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.isComposing || e.altKey || !(e.ctrlKey || e.metaKey)) return;
    const key = String(e.key || '').toLowerCase();
    const action = key === 's' ? (e.shiftKey ? 'save_as' : 'save')
      : key === 'o' ? 'open'
      : key === 'n' ? 'new'
      : key === 'm' && e.shiftKey ? 'toggle_mode' : null;
    if (!action) return; // Leave copy/paste, undo, navigation etc. alone.
    e.preventDefault();
    if (e.repeat || hasOpenAppDialog()) return;
    handleMenuAction(action);
  });

  // Drag & drop berkas .md (berjalan di webview maupun browser).
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  async function openDroppedFile(file) {
    if (restoreInProgress || closeInProgress || hasOpenAppDialog() || newInProgress || openInProgress) return false;
    openInProgress = true;
    fileBusy('open', true);
    const stamp = documentStamp();
    try {
      if (!isMarkdownFilename(file.name)) {
        fileFeedback('Berkas harus berekstensi .md, .markdown, atau .txt.', 'warning');
        return false;
      }
      fileFeedback('Membaca berkas yang dijatuhkan…');
      const result = await readBrowserFile(file);
      if (!documentUnchanged(stamp)) {
        fileFeedback('Drop dibatalkan karena ada perubahan baru. Tulisanmu tetap dipertahankan.', 'warning');
        return false;
      }
      if (dirty && !(await confirmDiscard(tauri))) {
        fileFeedback('Drop dibatalkan. Dokumen aktif tetap dipertahankan.');
        return false;
      }
      if (!documentUnchanged(stamp)) {
        fileFeedback('Drop dibatalkan karena dokumen berubah saat konfirmasi.', 'warning');
        return false;
      }
      discardDraft();
      // Browser File exposes only a basename, not a trustworthy native path.
      // Native Save must ask for a destination, not write to a relative path.
      currentPath = tauri ? null : result.path;
      diskBaseline = null;
      applyDocument(result.contents);
      markClean();
      fileFeedback('Dibuka: ' + basename(result.path) + (tauri ? ' — pilih lokasi saat menyimpan.' : ''));
      return true;
    } catch (err) {
      fileFeedback('Gagal membaca drop. Dokumen aktif tetap dipertahankan.', 'error');
      await showError(tauri, err && err.message ? err.message : String(err));
      return false;
    } finally {
      openInProgress = false;
      fileBusy('open', false);
    }
  }
  document.addEventListener('drop', function (e) {
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    e.preventDefault();
    if (restoreInProgress || closeInProgress || hasOpenAppDialog() || newInProgress || openInProgress) return;
    if (files.length !== 1) {
      fileFeedback('Jatuhkan satu berkas saja. Dokumen aktif tetap dipertahankan.', 'warning');
      return;
    }
    void openDroppedFile(files[0]);
  });

  /* Konfirmasi tutup jendela native (tombol X / Alt+F4).
     Tidak memakai preventDefault() secara permanen: bila handler async
     selesai tanpa mencegah, Tauri meneruskan penutupan. Draf sudah ditulis
     lebih dulu; kegagalan cadangan membatalkan keluar tanpa menyimpan. */
  let closeHandlerRegistered = false;
  if (tauri && tauri.window && typeof tauri.window.getCurrentWindow === 'function') {
    try {
      const win = tauri.window.getCurrentWindow();
      if (win && typeof win.onCloseRequested === 'function') {
        win.onCloseRequested(async function (event) {
          if (restoreInProgress || closeInProgress || saveInProgress || openInProgress || newInProgress || hasOpenAppDialog()) {
            event.preventDefault();
            return;
          }
          if (!dirty) return;
          closeInProgress = true;
          try {
            await flushDraft();
            const decision = await confirmSaveOnClose(tauri);
            if (decision === 'cancel') {
              event.preventDefault();
              fileFeedback('Keluar dibatalkan. Dokumen tetap terbuka.');
              return;
            }
            if (decision === 'discard') {
              // Include edits made while the prompt was open.
              const backedUp = await flushDraft();
              if (!backedUp) {
                event.preventDefault();
                await showError(tauri, 'Cadangan draf gagal. Jendela tetap terbuka; simpan berkas sebelum keluar.');
              }
              return;
            }
            const ok = await saveDocument(false);
            if (!ok || dirty) {
              event.preventDefault();
              if (ok && dirty) fileFeedback('Masih ada perubahan baru saat menyimpan. Jendela tetap terbuka — simpan lagi sebelum keluar.', 'warning');
            }
          } catch (err) {
            event.preventDefault();
            fileFeedback('Gagal menyelesaikan proses keluar. Dokumen tetap terbuka.', 'error');
          } finally {
            closeInProgress = false;
          }
        });
        closeHandlerRegistered = true;
      }
    } catch (e) { /* draf tetap menjadi jaminan */ }
  }

  /* Tawarkan pemulihan draf dari sesi sebelumnya. Dipanggil setelah konten
     awal dimuat, sehingga pengguna punya pembanding sebelum memutuskan. */
  async function restoreDraftIfAny() {
    if (closeInProgress || restoreInProgress || openInProgress || newInProgress || saveInProgress || hasOpenAppDialog() || dirty) return false;
    restoreInProgress = true;
    for (const action of ['new', 'open', 'save', 'archives', 'cleanup']) fileBusy(action, true);
    try {
      return await performRestoreDraft();
    } catch (err) {
      draftError.hidden = false;
      draftError.title = String(err?.message || err);
      fileFeedback('Pemulihan gagal. Berkas recovery tetap disimpan; coba lagi nanti.', 'error');
      return false;
    } finally {
      restoreInProgress = false;
      for (const action of ['new', 'open', 'save', 'archives', 'cleanup']) fileBusy(action, false);
    }
  }

  async function exportRecoveryArchive() {
    if (closeInProgress || restoreInProgress || openInProgress || newInProgress || saveInProgress || hasOpenAppDialog()) return false;
    // Read-only archive action: allowed even when the current editor is dirty.
    restoreInProgress = true;
    for (const action of ['new', 'open', 'save', 'archives', 'cleanup']) fileBusy(action, true);
    try {
      const rows = await recoveryStore.list();
      const legacy = tauri ? readDraft(draftStorage) : null;
      const legacyId = 'legacy-local-storage';
      if (legacy) rows.push({ id: legacyId, path: legacy.path, savedAt: legacy.savedAt });
      if (!rows.length) {
        fileFeedback('Tidak ada cadangan arsip untuk diekspor. Simpan dokumen aktif lewat Simpan.');
        return false;
      }
      const id = await pickRecovery(document, rows, { title: 'Pilih cadangan untuk diekspor sebagai Markdown' });
      if (!id) { fileFeedback('Ekspor cadangan dibatalkan. Arsip tetap disimpan.'); return false; }
      const draft = tauri && id === legacyId ? readDraft(draftStorage) : await recoveryStore.select(id);
      if (!draft) throw new Error('Cadangan sudah tidak tersedia');
      const filename = 'salinan-cadangan.md';
      const target = tauri
        ? await saveWithTauri(tauri, { path: filename, contents: draft.markdown, saveAs: true, forbiddenPaths: currentPath ? [currentPath] : [] })
        : downloadBrowserFile(filename, draft.markdown);
      if (!target) { fileFeedback('Ekspor cadangan dibatalkan. Arsip tetap disimpan.'); return false; }
      fileFeedback(tauri
        ? 'Salinan cadangan diekspor: ' + basename(target) + '. Arsip asal tetap disimpan.'
        : 'Unduhan salinan cadangan dimulai. Arsip asal tetap disimpan; periksa hasil unduhan.');
      return true;
    } catch (err) {
      fileFeedback('Ekspor cadangan gagal. Arsip asal tetap disimpan. ' + String(err?.message || err), 'error');
      return false;
    } finally {
      restoreInProgress = false;
      for (const action of ['new', 'open', 'save', 'archives', 'cleanup']) fileBusy(action, false);
    }
  }
  document.getElementById('btn-archives').addEventListener('click', exportRecoveryArchive);

  async function deleteRecoveryArchive() {
    if (closeInProgress || restoreInProgress || openInProgress || newInProgress || saveInProgress || hasOpenAppDialog()) return false;
    restoreInProgress = true;
    for (const action of ['new', 'open', 'save', 'archives', 'cleanup']) fileBusy(action, true);
    try {
      const rows = await recoveryStore.list();
      const legacyId = 'legacy-local-storage';
      if (tauri && draftStorage && draftStorage.getItem(DRAFT_KEY) !== null) {
        rows.push({ id: legacyId, path: 'Legacy localStorage', corrupt: !readDraft(draftStorage) });
      }
      if (!rows.length) { fileFeedback('Tidak ada arsip cadangan untuk dibersihkan.'); return false; }
      const id = await pickRecovery(document, rows, { title: 'Pilih arsip untuk dihapus permanen', deleting: true });
      if (!id) { fileFeedback('Penghapusan dibatalkan. Arsip tidak dihapus.'); return false; }
      const localLegacy = tauri && id === legacyId;
      const expected = localLegacy ? draftStorage.getItem(DRAFT_KEY) : !tauri ? await recoveryStore.inspect(id) : null;
      const row = rows.find((item) => item.id === id);
      const message = 'Hapus permanen arsip ' + (row?.path || id) + '?\n\n' +
        'ID: ' + id + '\nSeluruh snapshot arsip ini akan dihapus. Dokumen aktif dan berkas Markdown asli tidak dihapus. ' +
        'Ekspor salinan lebih dulu jika masih diperlukan. Tindakan ini tidak dapat dibatalkan.';
      let confirmed = false;
      if (tauri) {
        const answer = await tauri.dialog.message(message, { title: 'Hapus arsip cadangan', kind: 'warning', buttons: { ok: 'Hapus permanen', cancel: 'Batal' } });
        confirmed = answer === 'Hapus permanen' || answer === 'Ok';
      } else confirmed = window.confirm(message);
      if (!confirmed) { fileFeedback('Penghapusan dibatalkan. Arsip tidak dihapus.'); return false; }
      if (localLegacy) {
        if (expected === null || draftStorage.getItem(DRAFT_KEY) !== expected) throw new Error('Legacy berubah; pilih ulang');
        draftStorage.removeItem(DRAFT_KEY);
      } else await recoveryStore.remove(id, expected);
      fileFeedback('Arsip yang dipilih dihapus. Dokumen aktif tidak diubah.');
      return true;
    } catch (err) {
      fileFeedback('Cleanup belum selesai. Periksa ulang daftar arsip; sebagian berkas mungkin sudah terhapus. ' + String(err?.message || err), 'error');
      return false;
    } finally {
      restoreInProgress = false;
      for (const action of ['new', 'open', 'save', 'archives', 'cleanup']) fileBusy(action, false);
    }
  }
  document.getElementById('btn-cleanup').addEventListener('click', deleteRecoveryArchive);

  async function performRestoreDraft() {
    if (dirty) return false; // Recovery must never overwrite current unsaved work.
    const generation = documentGeneration;
    const revision = editRevision;
    let draft;
    try {
      if (recoveryStore) {
        const rows = await recoveryStore.list();
        if (rows.length) {
          const id = rows.length > 1 ? await pickRecovery(document, rows) : rows[0].id;
          if (!id || generation !== documentGeneration || revision !== editRevision) return false;
          if (rows.find((row) => row.id === id)?.corrupt) {
            fileFeedback('Cadangan tidak dapat dibaca. Berkas recovery tetap disimpan.', 'error');
            return false;
          }
          draft = await recoveryStore.select(id); // Read-only copy, not session adoption.
        } else {
          draft = await recoveryStore.read();
        }
      }
      if (!draft && tauri) draft = readDraft(draftStorage); // Migration from older versions.
    } catch (err) {
      draftError.hidden = false;
      draftError.title = String(err?.message || err);
      fileFeedback('Pemulihan gagal. Cadangan lama dan tulisan aktif tidak dihapus.', 'error');
      return false; // Never clear unreadable native backups.
    }
    if (!draft || generation !== documentGeneration || revision !== editRevision) return false;
    const ok = await confirmRestore(tauri, restoreMessage(draft.savedAt));
    if (generation !== documentGeneration || revision !== editRevision) {
      fileFeedback('Pemulihan dibatalkan karena ada perubahan baru. Tulisan aktif dan arsip tetap dipertahankan.', 'warning');
      return false;
    }
    if (!ok) {
      fileFeedback('Pemulihan ditunda. Cadangan lama tetap disimpan.');
      return false;
    }
    // Recovery can predate external changes to its source file. Import as a
    // copy: ordinary Save must request a destination, not overwrite that path.
    currentPath = null;
    diskBaseline = null;
    applyDocument(draft.markdown);
    markClean();          // reset dulu supaya markDirty() tidak di-skip
    markDirty();          // dokumen hasil pemulihan memang belum tersimpan
    fileFeedback('Draf dipulihkan sebagai salinan. Pilih lokasi saat menyimpan; berkas asal tidak ditimpa otomatis.');
    return true;
  }

  function onPageHide() { flushDraft(); }

  window.addEventListener('beforeunload', function (e) {
    onPageHide();
    // Di Tauri, konfirmasi sudah ditangani onCloseRequested. Mencegah di sini
    // juga bisa memunculkan dialog webview kedua di atas dialog native.
    if (tauri || !dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushDraft();
  });

  /* =========================================================
   * 6. Statistik — selalu dari sumber Markdown kanonik yang sama.
   * ======================================================= */
  function setImageNotice(text) {
    // Reassigning identical text still creates live-region mutations.
    if (sbNotice.textContent === text) return;
    sbNotice.textContent = text;
    sbNotice.title = text;
  }

  let statsTimer = null;
  function updateStats() {
    const canonical = getCanonicalMarkdown();
    const stats = documentStats(canonical);
    document.getElementById('stat-words').textContent = 'Words: ' + stats.words;
    document.getElementById('stat-chars').textContent = 'Chars: ' + stats.chars;

    // Raw mode has no current rendered image inventory. Never report stale
    // Quill images as blocked/allowed, or offer downloads from the hidden DOM.
    if (currentMode === 'markdown') {
      btnLoadImages.hidden = true;
      delete btnLoadImages.dataset.count;
      sbNotice.hidden = remoteImageCount(canonical) === 0;
      setImageNotice(sbNotice.hidden ? '' : 'Beralih ke WYSIWYG untuk meninjau dan memuat gambar.');
      syncStatusClearance();
      return;
    }

    // Hitung dari DOM, bukan hanya dari teks: yang penting adalah berapa
    // gambar yang BENAR-BENAR masih tertahan, bukan sekadar jumlah URL.
    const held = quill.root.querySelectorAll('img[data-mr-src]');
    const blocked = [];
    for (let i = 0; i < held.length; i++) {
      const url = held[i].getAttribute('data-mr-src');
      if (url && !isRemoteImageAllowed(url)) blocked.push(url);
    }
    const total = remoteImageCount(canonical);

    if (blocked.length) {
      sbNotice.hidden = false;
      setImageNotice(blocked.length + ' gambar jarak jauh diblokir');
      btnLoadImages.hidden = false;
      btnLoadImages.textContent = 'Muat gambar (' + blocked.length + ')';
      btnLoadImages.dataset.count = String(blocked.length);
    } else {
      btnLoadImages.hidden = true;
      sbNotice.hidden = total === 0;
      setImageNotice(total
        ? total + ' gambar jarak jauh diizinkan'
        : '');
    }
    syncStatusClearance();
  }

  let imageLoadInProgress = false;
  async function loadImageUrls(urls) {
    if (imageLoadInProgress || currentMode !== 'wysiwyg' || closeInProgress) return 0;
    const stamp = documentStamp();
    const stillCurrent = () => documentUnchanged(stamp) && currentMode === 'wysiwyg' && !closeInProgress;
    imageLoadInProgress = true;
    btnLoadImages.disabled = true;
    try {
      const unique = [...new Set(urls)];
      if (unique.length > 20) throw new Error('Maksimum 20 URL gambar per pemuatan');
      if (tauri) {
        for (const url of unique) {
          if (!stillCurrent()) return 0;
          const source = await tauri.core.invoke('download_image', { url });
          if (!stillCurrent()) return 0;
          setImageDisplaySource(url, source);
          revealAllowedImages(quill); // Keep successful items visible if a later download fails.
        }
      } else {
        allowAllRemoteImages(unique); // Browser fallback; native CSP stays strict.
      }
      return revealAllowedImages(quill);
    } catch (err) {
      if (stillCurrent()) await showError(tauri, String(err?.message || err));
      return 0;
    } finally {
      imageLoadInProgress = false;
      btnLoadImages.disabled = false;
      updateStats();
    }
  }
  async function loadRemoteImages() {
    if (currentMode !== 'wysiwyg' || closeInProgress || restoreInProgress || hasOpenAppDialog()) return 0;
    const urls = Array.from(quill.root.querySelectorAll('img[data-mr-src]'))
      .map((node) => node.getAttribute('data-mr-src')).filter((url) => !isRemoteImageAllowed(url));
    return loadImageUrls(urls);
  }

  btnLoadImages.addEventListener('click', loadRemoteImages);

  // Debounce: serializeLines() berjalan tiap ketikan kalau tidak ditunda.
  function scheduleStats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(updateStats, 120);
  }

  quill.on('text-change', function (delta, oldDelta, source) {
    if (source === 'user') markDirty();
    scheduleStats();
  });
  textarea.addEventListener('input', function () {
    markDirty();
    scheduleStats();
  });

  /* =========================================================
   * 7. Konten awal
   * ======================================================= */
  const defaultMarkdown = [
    '# Selamat Datang di MarkRust ✨',
    '',
    'Ini adalah **WYSIWYG Markdown Editor** yang dibuat dengan *Rust* + *Tauri*.',
    '',
    '## Cara Pakai',
    '',
    'Ketik langsung di area editor. Semua formatting **langsung terlihat** saat kamu',
    'mengetik — tidak perlu split view!',
    '',
    '### Fitur',
    '',
    '- **Bold**, *italic*, ~~strikethrough~~ langsung terlihat',
    '- Heading, blok kutipan, dan daftar (termasuk daftar bersarang)',
    '- Code block dengan syntax highlighting',
    '- Tabel, task list, tautan, gambar, dan garis pemisah',
    '',
    '### Contoh Code',
    '',
    '```rust',
    'fn main() {',
    '    println!("Hello, MarkRust!");',
    '}',
    '```',
    '',
    '> “Simplicity is the ultimate sophistication.”',
    '> — Leonardo da Vinci',
    '',
    '---',
    '',
    '| Format | Contoh |',
    '| --- | --- |',
    '| Tebal | **teks** |',
    '| Kode | `kode` |',
    '',
    'Ganti mode lewat dua tombol di kiri atas toolbar. 🚀',
    ''
  ].join('\n');

  loadMarkdownIntoQuill(defaultMarkdown);
  markClean();
  restoreDraftIfAny();

  // Jembatan untuk pengujian dan untuk integrasi Tauri di kemudian hari.
  window.MarkRust = {
    quill: quill,
    setMode: setMode,
    quillToMarkdown: quillToMarkdown,
    mdToQuillHtml: toHtml,
    getMarkdown: getCanonicalMarkdown,
    setMarkdown: function (md) {
      // Jembatan ini dipakai untuk mengganti dokumen, bukan sekadar toggle
      // mode. Reset kebijakan agar izin gambar tidak menular ke dokumen baru.
      documentGeneration++;
      resetImagePolicy();
      return loadMarkdownIntoQuill(md);
    },
    getStats: function () { return documentStats(getCanonicalMarkdown()); },
    isDirty: function () { return dirty; },
    markClean: markClean,
    getPath: function () { return currentPath; },
    newDocument: newDocument,
    openDocument: openDocument,
    saveDocument: saveDocument,
    handleMenuAction: handleMenuAction,
    restoreDraftIfAny: restoreDraftIfAny,
    exportRecoveryArchive: exportRecoveryArchive,
    deleteRecoveryArchive: deleteRecoveryArchive,
    loadRemoteImages: loadRemoteImages,
    flushDraft: flushDraft,
    discardDraft: discardDraft,
    draftKey: DRAFT_KEY,
    isCloseHandlerRegistered: function () { return closeHandlerRegistered; },
    isToolbarPinned: function () { return pinned; },
    isToolbarVisible: isToolbarShown
  };
}
