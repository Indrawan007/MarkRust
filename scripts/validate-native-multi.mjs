// R04: dua proses Tauri/Linux bersamaan, dokumen A/B, simpan A, kill B,
// restart B, lalu restore melalui dialog GTK sementara A tetap berjalan.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.resolve(root, process.env.MARKRUST_NATIVE_APP || 'src-tauri/target/debug/markrust');
const artifactDir = path.resolve(root, process.env.MARKRUST_NATIVE_ARTIFACTS || '/tmp/markrust-native');
const driverCommand = process.env.TAURI_DRIVER_PATH || 'tauri-driver';
const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const instances = [];
const results = [];
let tempRoot = '';
let sharedData = '';
let failure = null;

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

function workflowError(message) {
  if (!process.env.GITHUB_ACTIONS) return;
  const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.error(`::error::${escaped}`);
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

class NativeInstance {
  constructor(name, port, nativePort) {
    this.name = name;
    this.port = port;
    this.nativePort = nativePort;
    this.base = `http://127.0.0.1:${port}`;
    this.driver = null;
    this.driverError = null;
    this.output = '';
    this.log = null;
    this.sessionId = '';
  }

  record(chunk) {
    const text = String(chunk);
    this.output = (this.output + text).slice(-32768);
    this.log?.write(text);
  }

  async start() {
    this.log = fsSync.createWriteStream(path.join(artifactDir, `multi-${this.name}-driver.log`));
    const env = {
      ...process.env,
      XDG_DATA_HOME: sharedData,
      XDG_CONFIG_HOME: path.join(tempRoot, `config-${this.name}`),
      XDG_CACHE_HOME: path.join(tempRoot, `cache-${this.name}`)
    };
    await fs.mkdir(env.XDG_CONFIG_HOME, { recursive: true });
    await fs.mkdir(env.XDG_CACHE_HOME, { recursive: true });
    this.driver = spawn(driverCommand, ['--port', String(this.port), '--native-port', String(this.nativePort)], {
      cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env
    });
    this.driver.on('error', (error) => { this.driverError = error; this.record(`${error.stack || error}\n`); });
    this.driver.stdout.on('data', (chunk) => this.record(chunk));
    this.driver.stderr.on('data', (chunk) => this.record(chunk));
    await waitFor(`${this.name}: tauri-driver siap`, async () => {
      if (this.driverError) throw this.driverError;
      if (this.driver.exitCode !== null) throw new Error(`driver keluar: ${this.driver.exitCode}`);
      const status = await this.request('GET', '/status', undefined, 1000);
      return status?.ready !== false;
    }, 20000);
    const created = await this.request('POST', '/session', {
      capabilities: { alwaysMatch: { 'tauri:options': { application: appPath } } }
    }, 90000);
    this.sessionId = created?.sessionId;
    assert.ok(this.sessionId, `${this.name}: session ID tidak ada`);
    await this.request('POST', `${this.route()}/timeouts`, { script: 30000, pageLoad: 30000, implicit: 0 });
    await waitFor(`${this.name}: aplikasi native siap`, () => this.execute(
      'return !!(window.MarkRust && window.__TAURI__ && window.MarkRust.isCloseHandlerRegistered());'
    ));
  }

  route() { return `/session/${this.sessionId}`; }

  async request(method, route, body, timeout = 30000) {
    const response = await fetch(this.base + route, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; }
    catch { throw new Error(`${this.name}: respons non-JSON ${response.status}: ${text.slice(0, 500)}`); }
    const value = payload?.value;
    if (!response.ok || (value && typeof value === 'object' && value.error)) {
      throw new Error(`${this.name}: WebDriver ${method} ${route} gagal: ${JSON.stringify(value).slice(0, 2500)}`);
    }
    return value;
  }

  execute(script, args = []) {
    return this.request('POST', `${this.route()}/execute/sync`, { script, args });
  }

  executeAsync(script, args = []) {
    return this.request('POST', `${this.route()}/execute/async`, { script, args }, 45000);
  }

  async invoke(command, args = {}) {
    const result = await this.executeAsync(
      'const done = arguments[arguments.length - 1];' +
      'window.__TAURI__.core.invoke(arguments[0], arguments[1]).then(' +
      'value => done({ value }), error => done({ error: String(error) }));',
      [command, args]
    );
    if (result?.error) throw new Error(`${this.name}: IPC ${command}: ${result.error}`);
    return result?.value;
  }

  async openFile(selected) {
    const opened = await this.executeAsync(`
      const done = arguments[arguments.length - 1];
      const selected = arguments[0];
      const dialog = window.__TAURI__.dialog;
      const original = dialog.open;
      dialog.open = async () => selected;
      if (dialog.open === original) { done({ error: 'dialog.open tidak dapat distub' }); return; }
      window.MarkRust.openDocument().then(
        result => done({ result, path: window.MarkRust.getPath(), markdown: window.MarkRust.getMarkdown() }),
        error => done({ error: String(error) })
      );
    `, [selected]);
    if (opened?.error) throw new Error(`${this.name}: ${opened.error}`);
    return opened;
  }

  state() {
    return this.execute(`return {
      path: window.MarkRust.getPath(),
      dirty: window.MarkRust.isDirty(),
      markdown: window.MarkRust.getMarkdown(),
      title: document.title
    };`);
  }

  async screenshot(name) {
    if (!this.sessionId) return;
    const png = await this.request('GET', `${this.route()}/screenshot`);
    assert.equal(typeof png, 'string');
    await fs.writeFile(path.join(artifactDir, name), Buffer.from(png, 'base64'));
  }

  async click(selector) {
    const element = await this.request('POST', `${this.route()}/element`, {
      using: 'css selector', value: selector
    });
    const id = element?.[ELEMENT_KEY];
    assert.ok(id, `${this.name}: elemen tidak ditemukan: ${selector}`);
    await this.request('POST', `${this.route()}/element/${id}/click`, {});
  }

  pickerState() {
    return this.execute(`return {
      open: document.getElementById('recovery-dialog').open,
      buttons: Array.from(document.querySelectorAll('#recovery-list button'), button => button.textContent)
    };`);
  }

  recoveryState() {
    return this.execute(`return {
      path: window.MarkRust.getPath(), dirty: window.MarkRust.isDirty(),
      markdown: window.MarkRust.getMarkdown(),
      pickerOpen: document.getElementById('recovery-dialog').open,
      errorVisible: !document.getElementById('sb-draft-error').hidden
    };`);
  }

  async edit(marker) {
    await this.execute(`
      const q = window.MarkRust.quill;
      q.insertText(q.getLength() - 1, '\\n' + arguments[0], 'user');
    `, [marker]);
  }

  async recovery(marker) {
    return waitFor(`${this.name}: snapshot ${marker}`, async () => {
      const raw = await this.invoke('read_recovery');
      if (!raw) return false;
      const value = JSON.parse(raw);
      return value.markdown.includes(marker) ? value : false;
    }, 10000);
  }

  async save() {
    const saved = await this.executeAsync(`
      const done = arguments[arguments.length - 1];
      window.MarkRust.saveDocument(false).then(
        result => done({ result, dirty: window.MarkRust.isDirty(), path: window.MarkRust.getPath() }),
        error => done({ error: String(error) })
      );
    `);
    if (saved?.error) throw new Error(`${this.name}: ${saved.error}`);
    return saved;
  }

  async deleteSession() {
    if (!this.sessionId) return;
    await this.request('DELETE', this.route(), undefined, 10000);
    this.sessionId = '';
  }

  killDriver(signal = 'SIGTERM') {
    const child = this.driver;
    if (!child?.pid || child.exitCode !== null) return;
    try { process.kill(-child.pid, signal); }
    catch { try { child.kill(signal); } catch { /* sudah berakhir */ } }
  }

  async stop() {
    const child = this.driver;
    this.driver = null;
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch { try { child.kill('SIGTERM'); } catch { /* sudah berakhir */ } }
      let timer;
      await Promise.race([
        exited,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* sudah berakhir */ }
            resolve();
          }, 5000);
        })
      ]);
      clearTimeout(timer);
    }
    if (this.log) {
      await new Promise((resolve) => this.log.end(resolve));
      this.log = null;
    }
  }
}

async function launch(name, port, nativePort) {
  const instance = new NativeInstance(name, port, nativePort);
  instances.push(instance);
  await instance.start();
  return instance;
}

async function waitForPicker(instance, expectedPaths, label = 'picker recovery terlihat') {
  return waitFor(`${instance.name}: ${label}`, async () => {
    const state = await instance.pickerState();
    if (!state.open || state.buttons.length !== expectedPaths.length) return false;
    return expectedPaths.every((candidate) => state.buttons.some((text) => text.startsWith(candidate))) ? state : false;
  }, 10000);
}

async function findAppPids() {
  const expectedExe = await fs.realpath(appPath);
  const expectedEnv = `XDG_DATA_HOME=${sharedData}`;
  const entries = await fs.readdir('/proc');
  const pids = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (await fs.readlink(`/proc/${entry}/exe`) !== expectedExe) continue;
      const environ = await fs.readFile(`/proc/${entry}/environ`, 'utf8');
      if (environ.includes(expectedEnv)) pids.push(Number(entry));
    } catch { /* proses berakhir atau tidak dapat dibaca */ }
  }
  return pids.sort((a, b) => a - b);
}

async function expectPids(count, label) {
  return waitFor(label, async () => {
    const pids = await findAppPids();
    return pids.length === count ? pids : false;
  }, 10000);
}

async function readSnapshotMap() {
  const rootDir = path.join(sharedData, 'com.markrust.app', 'recovery-v2');
  const dirs = await fs.readdir(rootDir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const rows = [];
  for (const dir of dirs.filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const files = await fs.readdir(path.join(rootDir, dir.name), { withFileTypes: true });
    for (const file of files.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const key = `${dir.name}/${file.name}`;
      rows.push([key, await fs.readFile(path.join(rootDir, dir.name, file.name), 'utf8')]);
    }
  }
  return Object.fromEntries(rows);
}

async function fileTreeUsage(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    const meta = await fs.lstat(entryPath);
    if (meta.isDirectory()) total += await fileTreeUsage(entryPath);
    else if (meta.isFile()) total += meta.size;
  }
  return total;
}

async function recoveryUsage() {
  const base = path.join(sharedData, 'com.markrust.app');
  return (await fileTreeUsage(path.join(base, 'recovery-v1')))
    + (await fileTreeUsage(path.join(base, 'recovery-v2')));
}

function sessionSnapshots(map, id) {
  return Object.fromEntries(Object.entries(map).filter(([key]) => key.startsWith(`${id}/`)));
}

async function killPid(pid) {
  process.kill(pid, 'SIGKILL');
  await waitFor(`proses ${pid} berhenti`, async () => {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    if (!stat) return true;
    const end = stat.lastIndexOf(') ');
    return end >= 0 && stat.slice(end + 2, end + 3) === 'Z';
  }, 10000);
}

function x11(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8', env: process.env, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function x11WindowReport() {
  const ids = x11('xdotool', ['search', '--onlyvisible', '--name', '.*'])
    .split(/\s+/).filter(Boolean).slice(0, 200);
  const rows = [];
  for (const id of ids) {
    try { rows.push(`${id}\t${x11('xdotool', ['getwindowname', id])}`); }
    catch { /* jendela hilang */ }
  }
  return rows.join('\n') + '\n';
}

function captureX11(name) {
  x11('scrot', ['--overwrite', path.join(artifactDir, name)]);
}

function visibleRestoreDialogs() {
  try {
    return x11('xdotool', ['search', '--onlyvisible', '--name', 'Pulihkan draf'])
      .split(/\s+/).filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

async function confirmRestoreDialog({
  label = 'dialog restore B terlihat',
  screenshotName = 'multi-03-b-recovery-dialog.png',
  windowReportName = 'multi-restore-x11-windows.txt'
} = {}) {
  const dialogId = await waitFor(label, async () => {
    const ids = visibleRestoreDialogs();
    assert.equal(ids.length, 1, `Dialog restore harus tunggal: ${ids.join(', ')}`);
    return ids[0];
  }, 15000);
  await fs.writeFile(path.join(artifactDir, windowReportName), x11WindowReport(), 'utf8');
  captureX11(screenshotName);
  x11('xdotool', ['windowfocus', '--sync', dialogId]);
  x11('xdotool', ['key', '--clearmodifiers', 'alt+y']);
}

try {
  assert.equal(process.platform, 'linux', 'Validasi multi-instance ini hanya mendukung Linux/WebKitGTK');
  const appStat = await fs.stat(appPath).catch(() => null);
  assert.ok(appStat?.isFile(), `Binary Tauri tidak ditemukan: ${appPath}`);
  await fs.mkdir(artifactDir, { recursive: true });
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markrust-native-multi-'));
  sharedData = path.join(tempRoot, 'shared-data');
  await fs.mkdir(sharedData, { recursive: true });
  process.on('exit', () => { for (const instance of instances) instance.killDriver('SIGTERM'); });

  let a;
  let b;
  let c;
  let pidA;
  let pidB;
  const markerA = 'Suntingan A belum disimpan Ω.';
  const markerB = 'Suntingan B belum disimpan Ω.';
  const pathA = path.join(tempRoot, 'dokumen A Ω.md');
  const pathB = path.join(tempRoot, 'dokumen B Ω.md');
  const sourceA = '# Dokumen A\n\nIsi awal A.\n';
  const sourceB = '# Dokumen B\n\nIsi awal B.\n';
  await fs.writeFile(pathA, sourceA, 'utf8');
  await fs.writeFile(pathB, sourceB, 'utf8');
  let expectedA;
  let draftB;

  await step('dua proses native membuka dokumen A/B secara bersamaan', async () => {
    a = await launch('A', 4444, 4445);
    pidA = (await expectPids(1, 'PID instance A'))[0];
    b = await launch('B', 4446, 4447);
    const two = await expectPids(2, 'PID instance A dan B');
    pidB = two.find((pid) => pid !== pidA);
    assert.ok(pidB && pidB !== pidA, JSON.stringify(two));
    assert.deepEqual(await a.openFile(pathA), { result: true, path: pathA, markdown: sourceA });
    assert.deepEqual(await b.openFile(pathB), { result: true, path: pathB, markdown: sourceB });
    assert.equal((await a.state()).dirty, false);
    assert.equal((await b.state()).dirty, false);
    captureX11('multi-01-two-instances.png');
  });

  await step('simpan A membersihkan hanya recovery A dan tidak menghapus B', async () => {
    await a.edit(markerA);
    await b.edit(markerB);
    await a.recovery(markerA);
    draftB = await b.recovery(markerB);
    assert.equal(draftB.path, pathB);
    expectedA = (await a.state()).markdown;
    const saved = await a.save();
    assert.equal(saved.result, true, JSON.stringify(saved));
    assert.equal(saved.dirty, false, JSON.stringify(saved));
    assert.equal(await fs.readFile(pathA, 'utf8'), expectedA);
    await waitFor('recovery A bersih setelah simpan', async () => (await a.invoke('read_recovery')) === null, 5000);
    const survivingB = await b.recovery(markerB);
    assert.equal(survivingB.markdown, draftB.markdown);
    assert.equal(survivingB.path, pathB);
    assert.equal(await fs.readFile(pathB, 'utf8'), sourceB);
    captureX11('multi-02-a-saved-b-dirty.png');
  });

  await step('kill B, restart, restore B melalui dialog, dan A tetap utuh', async () => {
    await killPid(pidB);
    b.sessionId = '';
    await b.stop();
    assert.deepEqual(await expectPids(1, 'hanya A hidup setelah B di-kill'), [pidA]);
    const aAfterKill = await a.state();
    assert.equal(aAfterKill.path, pathA);
    assert.equal(aAfterKill.dirty, false);
    assert.equal(aAfterKill.markdown, expectedA);
    assert.equal(await fs.readFile(pathB, 'utf8'), sourceB);

    c = await launch('C', 4448, 4449);
    const restarted = await expectPids(2, 'A dan proses pengganti B');
    const pidC = restarted.find((pid) => pid !== pidA);
    assert.ok(pidC && pidC !== pidB, JSON.stringify({ restarted, pidA, pidB }));
    const recoveredDraft = await c.recovery(markerB);
    assert.equal(recoveredDraft.path, pathB);
    assert.equal(recoveredDraft.markdown, draftB.markdown);
    await confirmRestoreDialog();
    const restoredB = await waitFor('B pulih di editor', async () => {
      const state = await c.state();
      return state.path === pathB && state.dirty && state.markdown.includes(markerB) ? state : false;
    }, 10000);
    assert.equal(restoredB.markdown, draftB.markdown);
    assert.equal(await fs.readFile(pathB, 'utf8'), sourceB);
    const aStill = await a.state();
    assert.equal(aStill.path, pathA);
    assert.equal(aStill.dirty, false);
    assert.equal(aStill.markdown, expectedA);

    const savedB = await c.save();
    assert.equal(savedB.result, true, JSON.stringify(savedB));
    assert.equal(savedB.dirty, false, JSON.stringify(savedB));
    assert.equal(await fs.readFile(pathB, 'utf8'), draftB.markdown);
    await waitFor('recovery B bersih setelah hasil restore disimpan', async () => (await c.invoke('read_recovery')) === null, 5000);
    assert.equal((await a.state()).markdown, expectedA);
    assert.equal(await fs.readFile(pathA, 'utf8'), expectedA);
    captureX11('multi-04-b-restored-a-intact.png');
    await c.deleteSession();
    await a.deleteSession();
    await c.stop();
    await a.stop();
  });

  const r05PathD = path.join(tempRoot, 'stale D Ω.md');
  const r05PathE = path.join(tempRoot, 'stale E Ω.md');
  const r05SourceD = '# Stale D\n\nIsi awal D.\n';
  const r05SourceE = '# Stale E\n\nIsi awal E.\n';
  const r05MarkerD = 'Draf stale D yang dipilih Ω.';
  const r05MarkerE = 'Draf stale E yang dipilih Ω.';
  const r05Evidence = {};
  let r05BeforeDefer = null;
  await fs.writeFile(r05PathD, r05SourceD, 'utf8');
  await fs.writeFile(r05PathE, r05SourceE, 'utf8');

  await step('R05: pilih satu dari dua stale recovery dan pertahankan kandidat lain', async () => {
    await expectPids(0, 'semua proses R04 sudah berhenti');
    const d = await launch('D', 4450, 4451);
    const pidD = (await expectPids(1, 'PID pembuat stale D'))[0];
    const e = await launch('E', 4452, 4453);
    const two = await expectPids(2, 'PID pembuat stale D dan E');
    const pidE = two.find((pid) => pid !== pidD);
    assert.ok(pidE && pidE !== pidD, JSON.stringify(two));
    assert.deepEqual(await d.openFile(r05PathD), { result: true, path: r05PathD, markdown: r05SourceD });
    assert.deepEqual(await e.openFile(r05PathE), { result: true, path: r05PathE, markdown: r05SourceE });
    await d.edit(r05MarkerD);
    await e.edit(r05MarkerE);
    const draftD = await d.recovery(r05MarkerD);
    const draftE = await e.recovery(r05MarkerE);
    assert.equal(draftD.path, r05PathD);
    assert.equal(draftE.path, r05PathE);
    const rowsD = JSON.parse(await d.invoke('list_recoveries'));
    const rowsE = JSON.parse(await e.invoke('list_recoveries'));
    assert.equal(rowsD.length, 1, JSON.stringify(rowsD));
    assert.equal(rowsE.length, 1, JSON.stringify(rowsE));
    assert.equal(rowsD[0].path, r05PathD);
    assert.equal(rowsE[0].path, r05PathE);
    assert.notEqual(rowsD[0].id, rowsE[0].id, 'D dan E harus memiliki session berbeda');

    await killPid(pidD);
    d.sessionId = '';
    await d.stop();
    await killPid(pidE);
    e.sessionId = '';
    await e.stop();
    await expectPids(0, 'kedua pemilik stale sudah berhenti');
    const initialSnapshots = await readSnapshotMap();
    assert.equal(Object.keys(initialSnapshots).length, 2, JSON.stringify(Object.keys(initialSnapshots)));
    assert.ok(Object.keys(sessionSnapshots(initialSnapshots, rowsD[0].id)).length === 1);
    assert.ok(Object.keys(sessionSnapshots(initialSnapshots, rowsE[0].id)).length === 1);
    r05Evidence.initialSnapshotFiles = Object.keys(initialSnapshots);

    const f = await launch('F', 4454, 4455);
    const pidF = (await expectPids(1, 'PID pemilih stale'))[0];
    await waitForPicker(f, [r05PathD, r05PathE]);
    await f.screenshot('r05-01-picker.png');
    const rows = JSON.parse(await f.invoke('list_recoveries'));
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.deepEqual(rows.map((row) => row.path).sort(), [r05PathD, r05PathE].sort());
    const adopted = JSON.parse(await f.invoke('read_recovery'));
    assert.ok(adopted.path === r05PathD || adopted.path === r05PathE, JSON.stringify(adopted));
    // Pilih kandidat yang tidak diadopsi agar perpindahan lock benar-benar diuji.
    const chosenPath = adopted.path === r05PathD ? r05PathE : r05PathD;
    const unchosenPath = chosenPath === r05PathD ? r05PathE : r05PathD;
    const chosenMarker = chosenPath === r05PathD ? r05MarkerD : r05MarkerE;
    const unchosenMarker = chosenPath === r05PathD ? r05MarkerE : r05MarkerD;
    const chosenRow = rows.find((row) => row.path === chosenPath);
    const unchosenRow = rows.find((row) => row.path === unchosenPath);
    assert.ok(chosenRow && unchosenRow, JSON.stringify(rows));
    r05Evidence.sessionIds = rows.map((row) => row.id).sort();
    r05Evidence.selectedPath = chosenPath;
    r05Evidence.unselectedPath = unchosenPath;
    await f.click(`#recovery-list button:nth-child(${rows.indexOf(chosenRow) + 1})`);
    await confirmRestoreDialog({
      label: 'dialog GTK setelah memilih salah satu stale recovery',
      screenshotName: 'r05-02-restore-dialog.png',
      windowReportName: 'r05-restore-x11-windows.txt'
    });
    const restored = await waitFor('hanya kandidat pilihan yang dipulihkan', async () => {
      const state = await f.state();
      return state.path === chosenPath && state.dirty && state.markdown.includes(chosenMarker) ? state : false;
    }, 10000);
    assert.equal(restored.markdown.includes(unchosenMarker), false, 'Marker kandidat lain tidak boleh masuk editor');
    assert.equal(await fs.readFile(r05PathD, 'utf8'), r05SourceD);
    assert.equal(await fs.readFile(r05PathE, 'utf8'), r05SourceE);

    const afterSelection = await readSnapshotMap();
    assert.deepEqual(sessionSnapshots(afterSelection, unchosenRow.id),
      sessionSnapshots(initialSnapshots, unchosenRow.id), 'Snapshot kandidat lain harus identik');
    assert.ok(Object.keys(sessionSnapshots(afterSelection, chosenRow.id)).length >= 1);
    const remainingRows = JSON.parse(await f.invoke('list_recoveries'));
    assert.equal(remainingRows.length, 2, JSON.stringify(remainingRows));
    assert.deepEqual(remainingRows.map((row) => row.id).sort(), r05Evidence.sessionIds);
    r05Evidence.unselectedSnapshotUnchanged = true;
    r05Evidence.originalFilesUnchanged = true;
    await f.screenshot('r05-03-selected-restored.png');

    // Jadikan kedua kandidat stale lagi untuk skenario Nanti saja.
    await killPid(pidF);
    f.sessionId = '';
    await f.stop();
    await expectPids(0, 'proses pilihan pertama berhenti');
    r05BeforeDefer = await readSnapshotMap();
    const hasDraft = (id, candidatePath, marker) => Object.values(sessionSnapshots(r05BeforeDefer, id))
      .some((raw) => {
        const value = JSON.parse(raw);
        return value.path === candidatePath && value.markdown.includes(marker);
      });
    assert.ok(hasDraft(chosenRow.id, chosenPath, chosenMarker), 'Kandidat terpilih harus tetap ada setelah kill');
    assert.ok(hasDraft(unchosenRow.id, unchosenPath, unchosenMarker), 'Kandidat lain harus tetap ada setelah kill');
    r05Evidence.snapshotFilesBeforeDefer = Object.keys(r05BeforeDefer);
  });

  await step('R05: Nanti saja tidak memulihkan atau menghapus snapshot', async () => {
    assert.ok(r05BeforeDefer && Object.keys(r05BeforeDefer).length >= 2);
    const g = await launch('G', 4456, 4457);
    await expectPids(1, 'PID skenario Nanti saja');
    await waitForPicker(g, [r05PathD, r05PathE], 'picker kedua sebelum Nanti saja');
    const before = await g.state();
    assert.equal(before.path, null, JSON.stringify(before));
    assert.equal(before.dirty, false, JSON.stringify(before));
    assert.doesNotMatch(before.markdown, /Draf stale [DE] yang dipilih/);
    await g.screenshot('r05-04-picker-before-defer.png');

    await g.click('#recovery-dialog form button');
    await waitFor('picker tertutup setelah Nanti saja', async () => !(await g.pickerState()).open, 5000);
    await delay(800); // Beri kesempatan bug lanjutan restore/clear untuk terlihat.
    assert.deepEqual(visibleRestoreDialogs(), [], 'Nanti saja tidak boleh membuka konfirmasi GTK');
    const after = await g.state();
    assert.equal(after.path, before.path, JSON.stringify(after));
    assert.equal(after.dirty, false, JSON.stringify(after));
    assert.equal(after.markdown, before.markdown, 'Editor tidak boleh berubah setelah Nanti saja');
    assert.deepEqual(visibleRestoreDialogs(), []);
    const afterSnapshots = await readSnapshotMap();
    assert.deepEqual(afterSnapshots, r05BeforeDefer, 'Semua file snapshot harus identik setelah Nanti saja');
    const rowsAfter = JSON.parse(await g.invoke('list_recoveries'));
    assert.equal(rowsAfter.length, 2, JSON.stringify(rowsAfter));
    assert.deepEqual(rowsAfter.map((row) => row.id).sort(), r05Evidence.sessionIds);
    assert.equal(await fs.readFile(r05PathD, 'utf8'), r05SourceD);
    assert.equal(await fs.readFile(r05PathE, 'utf8'), r05SourceE);
    r05Evidence.defer = {
      editorUnchanged: true,
      allSnapshotFilesIdentical: true,
      candidatesRemaining: rowsAfter.length,
      originalFilesUnchanged: true
    };
    await fs.writeFile(path.join(artifactDir, 'r05-evidence.json'), JSON.stringify(r05Evidence, null, 2) + '\n', 'utf8');
    await g.screenshot('r05-05-deferred.png');
    await g.deleteSession();
    await g.stop();
  });

  await step('R06: dua instance berebut kandidat yang sama dan hanya satu menang', async () => {
    await expectPids(0, 'semua proses R05 sudah berhenti');
    // Pisahkan data R06 agar tiga kandidat berasal dari sesi yang terkendali.
    sharedData = path.join(tempRoot, 'shared-data-r06');
    await fs.mkdir(sharedData, { recursive: true });
    const candidates = [
      { name: 'A', path: path.join(tempRoot, 'race A Ω.md'), source: '# Race A\n\nIsi awal A.\n', marker: 'Draf bersama R06 A Ω.' },
      { name: 'B', path: path.join(tempRoot, 'race B Ω.md'), source: '# Race B\n\nIsi awal B.\n', marker: 'Draf bersama R06 B Ω.' },
      { name: 'C', path: path.join(tempRoot, 'race C Ω.md'), source: '# Race C\n\nIsi awal C.\n', marker: 'Draf bersama R06 C Ω.' }
    ];
    for (const candidate of candidates) await fs.writeFile(candidate.path, candidate.source, 'utf8');

    const makers = [];
    const makerPorts = [[4458, 4459], [4460, 4461], [4462, 4463]];
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const maker = await launch(`R06-maker-${candidate.name}`, makerPorts[index][0], makerPorts[index][1]);
      makers.push(maker);
      const pids = await expectPids(index + 1, `PID pembuat kandidat ${candidate.name}`);
      candidate.pid = pids.find((pid) => !candidates.slice(0, index).some((other) => other.pid === pid));
      assert.ok(candidate.pid, JSON.stringify({ index, pids }));
      assert.deepEqual(await maker.openFile(candidate.path), {
        result: true, path: candidate.path, markdown: candidate.source
      });
      await maker.edit(candidate.marker);
      const draft = await maker.recovery(candidate.marker);
      assert.equal(draft.path, candidate.path);
      const rows = JSON.parse(await maker.invoke('list_recoveries'));
      assert.equal(rows.length, 1, JSON.stringify(rows));
      assert.equal(rows[0].path, candidate.path);
      candidate.id = rows[0].id;
    }
    assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 3,
      JSON.stringify(candidates.map((candidate) => candidate.id)));
    for (let index = 0; index < makers.length; index++) {
      await killPid(candidates[index].pid);
      makers[index].sessionId = '';
      await makers[index].stop();
    }
    await expectPids(0, 'ketiga pemilik kandidat R06 berhenti');
    const initialSnapshots = await readSnapshotMap();
    assert.equal(Object.keys(initialSnapshots).length, 3, JSON.stringify(Object.keys(initialSnapshots)));
    for (const candidate of candidates) {
      assert.equal(Object.keys(sessionSnapshots(initialSnapshots, candidate.id)).length, 1,
        `Satu snapshot awal untuk ${candidate.name}`);
    }

    // Kandidat C diadopsi lebih dahulu, lalu B; A tetap menjadi kandidat
    // bersama yang terlihat pada picker kedua instance.
    const first = await launch('R06-first', 4464, 4465);
    await expectPids(1, 'PID penantang pertama');
    await waitForPicker(first, candidates.map((candidate) => candidate.path), 'picker tiga kandidat');
    await first.screenshot('r06-01-first-picker.png');
    const second = await launch('R06-second', 4466, 4467);
    await expectPids(2, 'PID kedua penantang');
    const shared = candidates[0];
    const adoptedBySecond = candidates[1];
    await waitForPicker(second, [shared.path, adoptedBySecond.path], 'picker dengan kandidat bersama');
    await second.screenshot('r06-02-second-picker.png');
    const beforeFirst = await first.recoveryState();
    const beforeSecond = await second.recoveryState();
    for (const before of [beforeFirst, beforeSecond]) {
      assert.equal(before.path, null, JSON.stringify(before));
      assert.equal(before.dirty, false, JSON.stringify(before));
      assert.equal(before.errorVisible, false, JSON.stringify(before));
    }
    const firstPicker = await first.pickerState();
    const secondPicker = await second.pickerState();
    const buttonIndex = (picker) => picker.buttons.findIndex((text) => text.startsWith(shared.path));
    const firstIndex = buttonIndex(firstPicker);
    const secondIndex = buttonIndex(secondPicker);
    assert.ok(firstIndex >= 0 && secondIndex >= 0, JSON.stringify({ firstPicker, secondPicker }));

    const clicks = await Promise.allSettled([
      first.click(`#recovery-list button:nth-child(${firstIndex + 1})`),
      second.click(`#recovery-list button:nth-child(${secondIndex + 1})`)
    ]);
    assert.deepEqual(clicks.map((result) => result.status), ['fulfilled', 'fulfilled'], JSON.stringify(clicks));

    let winner = null;
    let loser = null;
    let beforeWinner = null;
    let beforeLoser = null;
    await waitFor('tepat satu pemenang lock dan satu indikator gagal', async () => {
      const states = await Promise.all([first.recoveryState(), second.recoveryState()]);
      const dialogs = visibleRestoreDialogs();
      assert.ok(dialogs.length <= 1, `Dua instance tidak boleh sama-sama membuka restore: ${dialogs.join(', ')}`);
      if (states[0].pickerOpen || states[1].pickerOpen || dialogs.length !== 1) return false;
      const options = [
        { instance: first, state: states[0], other: states[1], before: beforeFirst },
        { instance: second, state: states[1], other: states[0], before: beforeSecond }
      ];
      const outcome = options.find((option) => !option.state.errorVisible && option.other.errorVisible);
      if (!outcome) return false;
      winner = outcome.instance;
      loser = winner === first ? second : first;
      beforeWinner = outcome.before;
      beforeLoser = winner === first ? beforeSecond : beforeFirst;
      return true;
    }, 15000);
    assert.ok(winner && loser && beforeWinner && beforeLoser, 'Hasil race harus lengkap');
    const winnerDraft = JSON.parse(await winner.invoke('read_recovery'));
    const loserDraft = JSON.parse(await loser.invoke('read_recovery'));
    assert.equal(winnerDraft.path, shared.path, 'Pemenang harus memegang kandidat bersama');
    assert.notEqual(loserDraft.path, shared.path, 'Yang kalah tidak boleh mengadopsi kandidat bersama');

    await confirmRestoreDialog({
      label: 'satu dialog GTK untuk pemenang R06',
      screenshotName: 'r06-03-one-restore-dialog.png',
      windowReportName: 'r06-race-x11-windows.txt'
    });
    const restored = await waitFor('pemenang R06 memulihkan kandidat bersama', async () => {
      const state = await winner.state();
      return state.path === shared.path && state.dirty && state.markdown.includes(shared.marker) ? state : false;
    }, 10000);
    assert.doesNotMatch(restored.markdown, /Draf bersama R06 [BC]/);
    const winnerAfter = await winner.recoveryState();
    const loserAfter = await loser.recoveryState();
    assert.equal(winnerAfter.errorVisible, false, JSON.stringify(winnerAfter));
    assert.equal(loserAfter.errorVisible, true, 'Instance yang kalah harus menampilkan kegagalan recovery');
    assert.equal(loserAfter.pickerOpen, false, JSON.stringify(loserAfter));
    assert.equal(loserAfter.path, beforeLoser.path, JSON.stringify(loserAfter));
    assert.equal(loserAfter.dirty, false, JSON.stringify(loserAfter));
    assert.equal(loserAfter.markdown, beforeLoser.markdown, 'Editor instance yang kalah tidak boleh berubah');
    assert.deepEqual(visibleRestoreDialogs(), []);
    assert.ok(beforeWinner.path === null && beforeWinner.dirty === false);

    const afterRace = await readSnapshotMap();
    for (const [key, raw] of Object.entries(initialSnapshots)) {
      assert.equal(afterRace[key], raw, `Snapshot awal tidak boleh berubah/hilang: ${key}`);
    }
    const additions = Object.keys(afterRace).filter((key) => !(key in initialSnapshots));
    assert.ok(additions.every((key) => key.startsWith(`${shared.id}/`)),
      `Versi baru hanya boleh berada pada kandidat pemenang: ${JSON.stringify(additions)}`);
    for (const candidate of candidates) {
      assert.equal(await fs.readFile(candidate.path, 'utf8'), candidate.source,
        `File asli ${candidate.name} tidak boleh berubah`);
    }
    const evidence = {
      sharedSessionId: shared.id,
      sharedPath: shared.path,
      winner: winner.name,
      loser: loser.name,
      loserErrorVisible: true,
      loserEditorUnchanged: true,
      originalSnapshotsPreserved: true,
      additionalSnapshotFiles: additions,
      originalFilesUnchanged: true
    };
    await fs.writeFile(path.join(artifactDir, 'r06-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    await winner.screenshot('r06-04-winner.png');
    await loser.screenshot('r06-05-loser.png');
    await first.stop();
    await second.stop();
  });

  await step('R08: kuota 256 MiB menolak snapshot tanpa menghapus sesi lain', async () => {
    await expectPids(0, 'semua proses R06 sudah berhenti');
    sharedData = path.join(tempRoot, 'shared-data-r08');
    await fs.mkdir(sharedData, { recursive: true });
    const pathA = path.join(tempRoot, 'kuota A Ω.md');
    const pathB = path.join(tempRoot, 'kuota B Ω.md');
    const sourceA = '# Kuota A\n\nIsi asli A.\n';
    const sourceB = '# Kuota B\n\nIsi asli B.\n';
    const markerA = 'Snapshot awal kuota A Ω.';
    const markerB = 'Snapshot sesi lain kuota B Ω.';
    const rejectedMarker = 'Edit yang harus ditolak saat kuota penuh Ω.';
    await fs.writeFile(pathA, sourceA, 'utf8');
    await fs.writeFile(pathB, sourceB, 'utf8');

    const quotaA = await launch('R08-A', 4468, 4469);
    const pidA = (await expectPids(1, 'PID pemilik kuota A'))[0];
    assert.deepEqual(await quotaA.openFile(pathA), { result: true, path: pathA, markdown: sourceA });
    await quotaA.edit(markerA);
    const draftA = await quotaA.recovery(markerA);
    assert.equal(draftA.path, pathA);

    const quotaB = await launch('R08-B', 4470, 4471);
    const two = await expectPids(2, 'PID kuota A dan B');
    const pidB = two.find((pid) => pid !== pidA);
    assert.ok(pidB, JSON.stringify({ two, pidA }));
    assert.deepEqual(await quotaB.openFile(pathB), { result: true, path: pathB, markdown: sourceB });
    await quotaB.edit(markerB);
    const draftB = await quotaB.recovery(markerB);
    assert.equal(draftB.path, pathB);
    await killPid(pidB);
    quotaB.sessionId = '';
    await quotaB.stop();
    assert.deepEqual(await expectPids(1, 'hanya kuota A hidup'), [pidA]);

    const beforeSnapshots = await readSnapshotMap();
    assert.equal(Object.keys(beforeSnapshots).length, 2, JSON.stringify(Object.keys(beforeSnapshots)));
    const entriesForPath = (candidatePath) => Object.entries(beforeSnapshots)
      .filter(([, raw]) => JSON.parse(raw).path === candidatePath);
    const ownEntries = entriesForPath(pathA);
    const otherEntries = entriesForPath(pathB);
    assert.equal(ownEntries.length, 1, JSON.stringify(Object.keys(beforeSnapshots)));
    assert.equal(otherEntries.length, 1, JSON.stringify(Object.keys(beforeSnapshots)));
    const ownSession = ownEntries[0][0].split('/')[0];
    const otherSession = otherEntries[0][0].split('/')[0];
    assert.notEqual(ownSession, otherSession);
    assert.equal(ownEntries[0][1], JSON.stringify(draftA));
    assert.equal(otherEntries[0][1], JSON.stringify(draftB));

    const limit = 256 * 1024 * 1024;
    const usageBeforeFilling = await recoveryUsage();
    const fillSize = limit - usageBeforeFilling;
    assert.ok(fillSize > 0, JSON.stringify({ usageBeforeFilling, limit }));
    const recoveryRoot = path.join(sharedData, 'com.markrust.app', 'recovery-v2');
    const fillerPath = path.join(recoveryRoot, 'quota-fill.tmp');
    // truncate() membuat sparse file: ukuran logis dihitung oleh kuota Rust,
    // tetapi CI tidak perlu menulis ratusan MiB ke blok disk fisik.
    const filler = await fs.open(fillerPath, 'wx', 0o600);
    try {
      await filler.truncate(fillSize);
      await filler.sync();
    } finally {
      await filler.close();
    }
    const fillerStat = await fs.stat(fillerPath);
    assert.equal(fillerStat.size, fillSize);
    const usageAtLimit = await recoveryUsage();
    assert.equal(usageAtLimit, limit, 'Direktori recovery harus tepat pada batas 256 MiB');

    const beforeEdit = await quotaA.recoveryState();
    assert.equal(beforeEdit.errorVisible, false, JSON.stringify(beforeEdit));
    assert.equal(beforeEdit.dirty, true, JSON.stringify(beforeEdit));
    await quotaA.edit(rejectedMarker);
    const expectedAfterEdit = await quotaA.recoveryState();
    assert.equal(expectedAfterEdit.path, pathA, JSON.stringify(expectedAfterEdit));
    assert.equal(expectedAfterEdit.dirty, true, JSON.stringify(expectedAfterEdit));
    assert.match(expectedAfterEdit.markdown, /Edit yang harus ditolak saat kuota penuh/);

    const failedState = await waitFor('error kuota R08 terlihat tanpa menghilangkan edit', async () => {
      const state = await quotaA.recoveryState();
      return state.errorVisible && state.dirty && state.markdown === expectedAfterEdit.markdown ? state : false;
    }, 10000);
    assert.equal(failedState.path, pathA, JSON.stringify(failedState));
    assert.equal(failedState.pickerOpen, false, JSON.stringify(failedState));
    const errorInfo = await quotaA.execute(`const element = document.getElementById('sb-draft-error'); return {
      hidden: element.hidden, title: element.title, text: element.textContent.trim()
    };`);
    assert.equal(errorInfo.hidden, false, JSON.stringify(errorInfo));
    assert.match(errorInfo.title, /Batas total recovery tercapai/);

    const persistedAfterFailure = JSON.parse(await quotaA.invoke('read_recovery'));
    assert.equal(persistedAfterFailure.markdown, draftA.markdown,
      'Snapshot lama tidak boleh berisi edit yang ditolak');
    assert.doesNotMatch(persistedAfterFailure.markdown, /Edit yang harus ditolak/);
    const afterRejected = await readSnapshotMap();
    assert.deepEqual(afterRejected, beforeSnapshots,
      'Penolakan kuota tidak boleh menambah, mengubah, atau menghapus snapshot');
    assert.deepEqual(sessionSnapshots(afterRejected, otherSession), sessionSnapshots(beforeSnapshots, otherSession),
      'Snapshot sesi lain harus identik');
    assert.equal((await fs.stat(fillerPath)).size, fillSize);
    assert.equal(await recoveryUsage(), limit, 'Kegagalan tidak boleh meninggalkan file baru di luar hitungan');
    assert.equal(await fs.readFile(pathA, 'utf8'), sourceA);
    assert.equal(await fs.readFile(pathB, 'utf8'), sourceB);
    await quotaA.screenshot('r08-01-quota-rejected.png');

    // Setelah ruang tersedia, flush yang sama harus berhasil tanpa save ke file
    // asli dan tanpa menghapus snapshot sesi B.
    await fs.unlink(fillerPath);
    assert.equal(await recoveryUsage(), usageBeforeFilling,
      'Tidak boleh ada file sisa dari penulisan yang ditolak');
    const flushed = await quotaA.executeAsync(`
      const done = arguments[arguments.length - 1];
      window.MarkRust.flushDraft().then(
        value => done({ value }), error => done({ error: String(error) })
      );
    `);
    if (flushed?.error) throw new Error(`R08 flush setelah ruang tersedia: ${flushed.error}`);
    assert.equal(flushed?.value, true, JSON.stringify(flushed));
    const recoveredDraft = await quotaA.recovery(rejectedMarker);
    assert.equal(recoveredDraft.path, pathA);
    assert.equal(recoveredDraft.markdown, expectedAfterEdit.markdown);
    const afterFlushState = await quotaA.recoveryState();
    assert.equal(afterFlushState.errorVisible, false, JSON.stringify(afterFlushState));
    assert.equal(afterFlushState.dirty, true, 'Backup berhasil tidak boleh membersihkan dirty');
    assert.equal(afterFlushState.path, pathA, JSON.stringify(afterFlushState));
    assert.equal(afterFlushState.markdown, expectedAfterEdit.markdown);
    const clearedError = await quotaA.execute(`const element = document.getElementById('sb-draft-error');
      return { hidden: element.hidden, title: element.title };`);
    assert.deepEqual(clearedError, { hidden: true, title: '' });

    const afterFlush = await readSnapshotMap();
    for (const [key, raw] of Object.entries(beforeSnapshots)) {
      assert.equal(afterFlush[key], raw, `Snapshot awal R08 berubah/hilang: ${key}`);
    }
    const additions = Object.keys(afterFlush).filter((key) => !(key in beforeSnapshots));
    assert.equal(additions.length, 1, JSON.stringify(additions));
    assert.ok(additions[0].startsWith(`${ownSession}/`), JSON.stringify({ additions, ownSession }));
    assert.equal(JSON.parse(afterFlush[additions[0]]).markdown, expectedAfterEdit.markdown);
    assert.deepEqual(sessionSnapshots(afterFlush, otherSession), sessionSnapshots(beforeSnapshots, otherSession),
      'Write setelah kuota tersedia tidak boleh menyentuh sesi B');
    assert.equal(await fs.readFile(pathA, 'utf8'), sourceA);
    assert.equal(await fs.readFile(pathB, 'utf8'), sourceB);

    const evidence = {
      limitBytes: limit,
      usageBeforeFilling,
      sparseFillBytes: fillSize,
      usageAtLimit,
      rejection: {
        errorVisible: true,
        dirtyPreserved: true,
        rejectedEditNotPersisted: true,
        allSnapshotFilesIdentical: true,
        otherSessionSnapshotsIdentical: true,
        originalFilesUnchanged: true
      },
      afterSpaceFreed: {
        flushSucceeded: true,
        errorCleared: true,
        dirtyStillPresent: true,
        additionalSnapshotFiles: additions,
        otherSessionSnapshotsIdentical: true,
        originalFilesUnchanged: true
      }
    };
    await fs.writeFile(path.join(artifactDir, 'r08-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    await quotaA.screenshot('r08-02-write-resumed.png');
    await quotaA.stop();
  });
} catch (error) {
  failure = error;
  console.error(error.stack || error);
  workflowError(error.message);
  if (process.env.DISPLAY) {
    try {
      await fs.writeFile(path.join(artifactDir, 'multi-failure-x11-windows.txt'), x11WindowReport(), 'utf8');
      captureX11('multi-failure-x11.png');
    } catch { /* display mungkin sudah tidak tersedia */ }
  }
} finally {
  for (const instance of [...instances].reverse()) {
    try { await instance.stop(); } catch { /* lanjutkan cleanup instance lain */ }
  }
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('\nRingkasan validasi multi-instance:', JSON.stringify(results, null, 2));
if (failure) {
  for (const instance of instances) {
    if (instance.output.trim()) workflowError(`${instance.name}: ${instance.output.slice(-1800)}`);
  }
  process.exitCode = 1;
}
