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

async function confirmRestoreDialog() {
  const dialogId = await waitFor('dialog restore B terlihat', async () => {
    const ids = x11('xdotool', ['search', '--onlyvisible', '--name', 'Pulihkan draf'])
      .split(/\s+/).filter(Boolean);
    assert.equal(ids.length, 1, `Dialog restore harus tunggal: ${ids.join(', ')}`);
    return ids[0];
  }, 15000);
  await fs.writeFile(path.join(artifactDir, 'multi-restore-x11-windows.txt'), x11WindowReport(), 'utf8');
  captureX11('multi-03-b-recovery-dialog.png');
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
