// Validasi aplikasi Tauri native melalui tauri-driver + WebKitWebDriver.
// Linux/WebKitGTK saja; bukan pengganti matriks manual Windows/macOS/Linux.
// Tidak ada dependensi npm: Node 22+ menyediakan fetch yang dipakai di sini.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.resolve(root, process.env.MARKRUST_NATIVE_APP || 'src-tauri/target/debug/markrust');
const artifactDir = path.resolve(root, process.env.MARKRUST_NATIVE_ARTIFACTS || '/tmp/markrust-native');
const driverCommand = process.env.TAURI_DRIVER_PATH || 'tauri-driver';
let port = Number(process.env.TAURI_DRIVER_PORT || 4444);
let nativePort = Number(process.env.TAURI_NATIVE_DRIVER_PORT || 4445);
let base = `http://127.0.0.1:${port}`;
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let environment = null;

let driver;
let driverError = null;
let driverOutput = '';
let driverLog;
let sessionId = '';
let tempRoot = '';
let failure = null;
let skipSessionCleanup = false;

function recordDriver(chunk) {
  const text = String(chunk);
  driverOutput = (driverOutput + text).slice(-65536);
  driverLog?.write(text);
}

function killDriver(signal = 'SIGTERM') {
  if (!driver?.pid || driver.exitCode !== null) return;
  try { process.kill(-driver.pid, signal); }
  catch {
    try { driver.kill(signal); } catch { /* proses sudah berakhir */ }
  }
}

async function stopDriver() {
  if (!driver || driver.exitCode !== null) return;
  const exited = new Promise((resolve) => driver.once('exit', resolve));
  killDriver('SIGTERM');
  let timer;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timer = setTimeout(() => { killDriver('SIGKILL'); resolve(); }, 5000);
    })
  ]);
  clearTimeout(timer);
}

async function request(method, route, body, timeout = 30000) {
  const response = await fetch(base + route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; }
  catch { throw new Error(`WebDriver ${method} ${route}: respons non-JSON (${response.status}): ${text.slice(0, 1000)}`); }
  const value = payload?.value;
  if (!response.ok || (value && typeof value === 'object' && value.error)) {
    throw new Error(`WebDriver ${method} ${route} gagal (${response.status}): ${JSON.stringify(value).slice(0, 3000)}`);
  }
  return value;
}

const sessionRoute = () => `/session/${sessionId}`;
const execute = (script, args = []) => request('POST', `${sessionRoute()}/execute/sync`, { script, args });
const executeAsync = (script, args = []) => request('POST', `${sessionRoute()}/execute/async`, { script, args }, 45000);

async function waitFor(label, probe, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { lastError = error.message; }
    await delay(200);
  }
  throw new Error(`Timeout menunggu ${label}.${lastError ? ` Error terakhir: ${lastError}` : ''}`);
}

async function screenshot(name) {
  if (!sessionId) return;
  const png = await request('GET', `${sessionRoute()}/screenshot`);
  assert.equal(typeof png, 'string');
  await fs.writeFile(path.join(artifactDir, name), Buffer.from(png, 'base64'));
}

async function step(name, task) {
  try {
    await task();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    throw error;
  }
}

function workflowError(message) {
  if (!process.env.GITHUB_ACTIONS) return;
  const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error::${escaped}`);
}

async function pressControlShiftM() {
  const CONTROL = '\uE009';
  const SHIFT = '\uE008';
  await request('POST', `${sessionRoute()}/actions`, {
    actions: [{
      type: 'key', id: 'keyboard', actions: [
        { type: 'keyDown', value: CONTROL },
        { type: 'keyDown', value: SHIFT },
        { type: 'keyDown', value: 'm' },
        { type: 'keyUp', value: 'm' },
        { type: 'keyUp', value: SHIFT },
        { type: 'keyUp', value: CONTROL }
      ]
    }]
  });
}

async function invoke(command, args = {}) {
  return executeAsync(
    'const done = arguments[arguments.length - 1];' +
    'window.__TAURI__.core.invoke(arguments[0], arguments[1]).then(' +
    'value => done({ value }), error => done({ error: String(error) }));',
    [command, args]
  ).then((result) => {
    if (result?.error) throw new Error(`IPC ${command}: ${result.error}`);
    return result?.value;
  });
}

async function startDriver() {
  driverError = null;
  recordDriver(`\n--- tauri-driver ${port} / WebKitWebDriver ${nativePort} ---\n`);
  driver = spawn(driverCommand, ['--port', String(port), '--native-port', String(nativePort)], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      XDG_DATA_HOME: path.join(tempRoot, 'data'),
      XDG_CONFIG_HOME: path.join(tempRoot, 'config'),
      XDG_CACHE_HOME: path.join(tempRoot, 'cache')
    }
  });
  driver.on('error', (error) => { driverError = error; recordDriver(`${error.stack || error}\n`); });
  driver.stdout.on('data', recordDriver);
  driver.stderr.on('data', recordDriver);
  await waitFor('tauri-driver siap', async () => {
    if (driverError) throw driverError;
    if (driver.exitCode !== null) throw new Error(`tauri-driver keluar dengan kode ${driver.exitCode}`);
    const status = await request('GET', '/status', undefined, 1000);
    return status?.ready !== false;
  }, 20000);
}

async function createSession() {
  const created = await request('POST', '/session', {
    capabilities: { alwaysMatch: { 'tauri:options': { application: appPath } } }
  }, 90000);
  sessionId = created?.sessionId;
  assert.ok(sessionId, `Session ID tidak ada: ${JSON.stringify(created)}`);
  await request('POST', `${sessionRoute()}/timeouts`, { script: 30000, pageLoad: 30000, implicit: 0 });
}

async function restartDriverAndSession() {
  await stopDriver();
  driver = undefined;
  // Jangan bergantung pada waktu pelepasan port native driver lama.
  port += 2;
  nativePort += 2;
  base = `http://127.0.0.1:${port}`;
  await startDriver();
  await createSession();
}

async function findAppPids() {
  const expectedExe = await fs.realpath(appPath);
  const expectedEnv = `XDG_DATA_HOME=${path.join(tempRoot, 'data')}`;
  const entries = await fs.readdir('/proc');
  const pids = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const exe = await fs.readlink(`/proc/${entry}/exe`);
      if (exe !== expectedExe) continue;
      const environ = await fs.readFile(`/proc/${entry}/environ`, 'utf8');
      if (environ.includes(expectedEnv)) pids.push(Number(entry));
    } catch { /* proses berakhir atau /proc tidak dapat dibaca */ }
  }
  return pids;
}

async function forceKillApp() {
  const pids = await findAppPids();
  assert.equal(pids.length, 1, `Harus ada tepat satu proses MarkRust untuk data uji; ditemukan: ${pids.join(', ')}`);
  const pid = pids[0];
  process.kill(pid, 'SIGKILL');
  sessionId = ''; // Sesi WebDriver untuk proses itu tidak dapat dipakai lagi.
  await waitFor(`proses MarkRust ${pid} berhenti`, async () => {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    if (!stat) return true;
    const endCommand = stat.lastIndexOf(') ');
    const state = endCommand >= 0 ? stat.slice(endCommand + 2, endCommand + 3) : '';
    return state === 'Z'; // Zombie sudah mati dan lock OS sudah dilepas.
  }, 10000);
  return pid;
}

try {
  assert.equal(process.platform, 'linux', 'Harness native ini saat ini hanya mendukung Linux/WebKitGTK');
  const appStat = await fs.stat(appPath).catch(() => null);
  assert.ok(appStat?.isFile(), `Binary Tauri tidak ditemukan: ${appPath}. Jalankan cargo build --manifest-path src-tauri/Cargo.toml terlebih dahulu.`);
  await fs.mkdir(artifactDir, { recursive: true });
  driverLog = fsSync.createWriteStream(path.join(artifactDir, 'tauri-driver.log'));
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markrust-native-e2e-'));
  for (const dir of ['data', 'config', 'cache']) {
    await fs.mkdir(path.join(tempRoot, dir), { recursive: true });
  }

  process.on('exit', () => killDriver('SIGTERM'));
  await startDriver();
  await createSession();

  await step('boot WebKitGTK native, API Tauri, dan close handler', async () => {
    await waitFor('window.MarkRust dan window.__TAURI__', () => execute(
      'return !!(window.MarkRust && window.__TAURI__ && window.MarkRust.isCloseHandlerRegistered());'
    ));
    const info = await execute(`return {
      userAgent: navigator.userAgent,
      title: document.title,
      words: window.MarkRust.getStats().words,
      editorVisible: !!document.getElementById('editor').getBoundingClientRect().height,
      closeHandler: window.MarkRust.isCloseHandlerRegistered()
    };`);
    assert.ok(info.words > 0, JSON.stringify(info));
    assert.equal(info.editorVisible, true, JSON.stringify(info));
    assert.equal(info.closeHandler, true, JSON.stringify(info));
    environment = info;
    console.log('WebView:', info.userAgent);
    await screenshot('01-native-boot.png');
  });

  await step('fidelity raw/hard break dan Ctrl+Shift+M di webview native', async () => {
    const source = [
      '---', 'title: Native Ω', '---', '',
      '> - satu', '> - dua', '',
      '<div class="native">HTML</div>', '',
      '<script>window.__nativeTidakBolehJalan = true;</script>', '',
      'baris satu\\', 'baris dua', ''
    ].join('\n');
    const actual = await execute(
      'window.MarkRust.setMarkdown(arguments[0]); return window.MarkRust.getMarkdown();', [source]
    );
    assert.equal(actual, source);
    const structure = await execute(`return {
      raw: document.querySelectorAll('.mr-raw-block').length,
      frontmatter: document.querySelectorAll('.mr-frontmatter').length,
      hardBreak: document.querySelectorAll('mr-hard-break').length,
      scripts: document.querySelectorAll('.ql-editor script').length,
      executed: typeof window.__nativeTidakBolehJalan !== 'undefined'
    };`);
    assert.deepEqual(structure, { raw: 3, frontmatter: 1, hardBreak: 1, scripts: 0, executed: false });
    const editor = await request('POST', `${sessionRoute()}/element`, { using: 'css selector', value: '.ql-editor' });
    await request('POST', `${sessionRoute()}/element/${editor[ELEMENT_KEY]}/click`, {});
    await pressControlShiftM();
    const raw = await execute(
      "return { visible: getComputedStyle(document.getElementById('raw-view')).display !== 'none', value: document.getElementById('raw-textarea').value };"
    );
    assert.deepEqual(raw, { visible: true, value: source });
    await pressControlShiftM();
    assert.equal(await execute('return window.MarkRust.getMarkdown();'), source);
    await screenshot('02-native-fidelity.png');
  });

  await step('buka, recovery disk, dan simpan melalui IPC Rust (path Unicode/spasi)', async () => {
    const sourcePath = path.join(tempRoot, 'dokumen uji Ω.md');
    const source = '# Dari native\n\nKonten Unicode Ω dan spasi.\n';
    await fs.writeFile(sourcePath, source, 'utf8');

    // Hanya pemilihan path pada dialog yang distub. read_document, recovery,
    // write_document, state UI, dan serializer tetap memakai implementasi nyata.
    const opened = await executeAsync(`
      const done = arguments[arguments.length - 1];
      const selected = arguments[0];
      const dialog = window.__TAURI__.dialog;
      const original = dialog.open;
      dialog.open = async () => selected;
      if (dialog.open === original) { done({ error: 'dialog.open tidak dapat distub untuk pengujian' }); return; }
      window.MarkRust.openDocument().then(
        result => done({ result, path: window.MarkRust.getPath(), markdown: window.MarkRust.getMarkdown() }),
        error => done({ error: String(error) })
      );
    `, [sourcePath]);
    if (opened?.error) throw new Error(opened.error);
    assert.deepEqual(opened, { result: true, path: sourcePath, markdown: source });

    await execute(`
      const q = window.MarkRust.quill;
      q.insertText(q.getLength() - 1, '\\nTambahan native Ω.', 'user');
    `);
    await waitFor('dokumen kotor setelah edit', () => execute('return window.MarkRust.isDirty();'), 5000);
    const draft = await waitFor('snapshot recovery native', async () => {
      const recovery = await invoke('read_recovery');
      if (!recovery) return false;
      const value = JSON.parse(recovery);
      return value.markdown.includes('Tambahan native Ω.') ? value : false;
    }, 8000);
    assert.equal(draft.path, sourcePath);
    assert.match(draft.markdown, /Tambahan native Ω\./);

    const expected = await execute('return window.MarkRust.getMarkdown();');
    const saved = await executeAsync(`
      const done = arguments[arguments.length - 1];
      window.MarkRust.saveDocument(false).then(
        result => done({ result, dirty: window.MarkRust.isDirty(), path: window.MarkRust.getPath(), title: document.title }),
        error => done({ error: String(error) })
      );
    `);
    if (saved?.error) throw new Error(saved.error);
    assert.equal(saved.result, true, JSON.stringify(saved));
    assert.equal(saved.dirty, false, JSON.stringify(saved));
    assert.equal(saved.path, sourcePath, JSON.stringify(saved));
    assert.equal(await fs.readFile(sourcePath, 'utf8'), expected);
    assert.match(saved.title, /dokumen uji Ω\.md/);
    assert.doesNotMatch(saved.title, /●/);
    await waitFor('recovery dibersihkan setelah simpan', async () => (await invoke('read_recovery')) === null, 5000);
    assert.equal(await invoke('read_document', { path: sourcePath }), expected);
    await screenshot('03-native-saved.png');
  });

  await step('force-kill/restart mempertahankan snapshot untuk instance native baru', async () => {
    const marker = 'Draf force-kill Ω.';
    const crashPath = await execute('return window.MarkRust.getPath();');
    const savedOnDisk = await fs.readFile(crashPath, 'utf8');
    await execute(`
      const q = window.MarkRust.quill;
      q.insertText(q.getLength() - 1, '\\n' + arguments[0], 'user');
    `, [marker]);
    const beforeDraft = await waitFor('snapshot sebelum force-kill', async () => {
      const recovery = await invoke('read_recovery');
      if (!recovery) return false;
      const value = JSON.parse(recovery);
      return value.markdown.includes(marker) ? value : false;
    }, 8000);
    assert.equal(beforeDraft.path, crashPath);

    const firstPid = await forceKillApp();
    // Restore berikutnya mungkin membuka dialog native; jangan menutup lewat UI.
    skipSessionCleanup = true;
    await restartDriverAndSession();
    await waitFor('instance MarkRust baru setelah restart', () => execute(
      'return !!(window.MarkRust && window.__TAURI__ && window.MarkRust.isCloseHandlerRegistered());'
    ));
    const secondPids = await findAppPids();
    assert.equal(secondPids.length, 1, JSON.stringify(secondPids));
    assert.notEqual(secondPids[0], firstPid, 'Restart harus memakai proses OS baru');

    const afterDraft = await waitFor('snapshot terbaca dari instance baru', async () => {
      const recovery = await invoke('read_recovery');
      if (!recovery) return false;
      const value = JSON.parse(recovery);
      return value.markdown.includes(marker) ? value : false;
    }, 10000);
    assert.equal(afterDraft.path, crashPath);
    assert.equal(afterDraft.markdown, beforeDraft.markdown);
    const rows = JSON.parse(await invoke('list_recoveries'));
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0].path, crashPath);
    // Tidak ada autosave: edit yang hanya ada di recovery tidak masuk file asli.
    assert.equal(await fs.readFile(crashPath, 'utf8'), savedOnDisk);
    await screenshot('04-native-recovery-restart.png');
    // Dialog restore belum dikonfirmasi; akhiri proses uji tanpa memilih jawaban.
    await forceKillApp();
  });
} catch (error) {
  failure = error;
  console.error(error.stack || error);
  workflowError(error.message);
  if (sessionId) {
    try { await screenshot('failure.png'); } catch { /* abaikan kegagalan bukti tambahan */ }
  }
} finally {
  if (sessionId && !skipSessionCleanup) {
    try {
      await execute('window.MarkRust.discardDraft(); window.MarkRust.markClean();');
      await request('DELETE', sessionRoute(), undefined, 10000);
    } catch { /* driver dihentikan di bawah bila sesi/macet */ }
  } else if (sessionId) {
    try { await forceKillApp(); } catch { /* driver tetap dihentikan */ }
  }
  await stopDriver();
  if (driverLog) await new Promise((resolve) => driverLog.end(resolve));
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('\nRingkasan validasi native:', JSON.stringify({ environment, steps: results }, null, 2));
if (failure) {
  if (driverOutput.trim()) workflowError(`Log tauri-driver (akhir): ${driverOutput.slice(-3000)}`);
  process.exitCode = 1;
}
