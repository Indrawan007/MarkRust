/*
 * Validasi runtime Chromium sungguhan. Ini BUKAN pengganti checklist Tauri
 * native. Dependensi sengaja opsional; lihat README bagian "Validasi browser".
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.join(ROOT, 'ui');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml'
};

function serveUi() {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filename = path.resolve(UI, relative);
      if (filename !== UI && !filename.startsWith(UI + path.sep)) {
        res.writeHead(403); res.end(); return;
      }
      const body = await fs.readFile(filename);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filename)] || 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      res.writeHead(404); res.end('Not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: 'http://127.0.0.1:' + address.port });
    });
  });
}

async function browserLauncher() {
  let playwright;
  try {
    ({ chromium: playwright } = await import('playwright-core'));
  } catch (error) {
    throw new Error('Pasang tooling opsional: npm install --no-save --package-lock=false playwright-core @sparticuz/chromium');
  }
  if (process.env.CHROMIUM_PATH) {
    return { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  }
  try {
    const { default: Chromium, inflate, setupLambdaEnvironment } = await import('@sparticuz/chromium');
    if (process.platform === 'linux') {
      await inflate(path.join(ROOT, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
      setupLambdaEnvironment('/tmp/al2023/lib');
    }
    return {
      executablePath: await Chromium.executablePath(),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking']
    };
  } catch (error) {
    throw new Error('Chromium tidak tersedia. Pasang @sparticuz/chromium atau set CHROMIUM_PATH. ' + error.message);
  }
}

const results = [];
async function run(name, task) {
  try {
    await task();
    results.push({ name, status: 'PASS' });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack || String(error) });
    console.error('FAIL', name, '\n' + (error.stack || error));
  }
}

const { server, url } = await serveUi();
let browser;
try {
  const launcher = await browserLauncher();
  browser = await playwrightLaunch(launcher);
  console.log('Chromium:', await browser.version());

  async function playwrightLaunch(options) {
    const { chromium } = await import('playwright-core');
    return chromium.launch({ ...options, headless: true });
  }

  async function openApp() {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.MarkRust);
    return { page, errors };
  }

  await run('boot, rendering, console, dan viewport minimum', async () => {
    const { page, errors } = await openApp();
    assert.equal(await page.locator('#toolbar').isVisible(), true);
    assert.equal(await page.locator('#editor').isVisible(), true);
    assert.match(await page.locator('#stat-words').textContent(), /Words: [1-9]/);
    await page.setViewportSize({ width: 700, height: 500 });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      modeRight: document.getElementById('btn-markdown').getBoundingClientRect().right,
      pinRight: document.getElementById('btn-pin').getBoundingClientRect().right,
      width: window.innerWidth,
      statusVisible: !!document.getElementById('statusbar').getBoundingClientRect().height
    }));
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.ok(layout.modeRight <= layout.width && layout.pinRight <= layout.width, JSON.stringify(layout));
    assert.equal(layout.statusVisible, true);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await run('front matter, raw block, hard break, dan toggle keyboard', async () => {
    const { page, errors } = await openApp();
    const source = [
      '---', 'title: Runtime', '---', '',
      '> - satu', '> - dua', '',
      '<div class="kotak">HTML</div>', '',
      '<script>window.__tidakBolehJalan = true;</script>', '',
      'baris satu\\', 'baris dua', ''
    ].join('\n');
    await page.locator('#btn-markdown').click();
    await page.locator('#raw-textarea').fill(source);
    await page.locator('#btn-wysiwyg').click();
    assert.equal(await page.evaluate(() => window.MarkRust.getMarkdown()), source);
    assert.equal(await page.locator('.mr-frontmatter').count(), 1);
    assert.equal(await page.locator('.mr-raw-block').count(), 3);
    assert.equal(await page.locator('mr-hard-break').count(), 1);
    assert.equal(await page.locator('.ql-editor script').count(), 0);
    assert.equal(await page.evaluate(() => window.__tidakBolehJalan), undefined);
    const hardBreakText = await page.locator('.ql-editor p').last().innerText();
    assert.match(hardBreakText, /baris satu\s*\n\s*baris dua/);
    await page.screenshot({ path: '/tmp/markrust-raw-runtime.png', fullPage: true });
    await page.locator('.ql-editor').click();
    await page.keyboard.press('Control+Shift+M');
    assert.equal(await page.locator('#raw-textarea').inputValue(), source);
    await page.keyboard.press('Control+Shift+M');
    assert.equal(await page.evaluate(() => window.MarkRust.getMarkdown()), source);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await run('buka file, ketik, recovery, dan unduhan browser', async () => {
    const { page, errors } = await openApp();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#btn-open').click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'runtime.md', mimeType: 'text/markdown',
      buffer: Buffer.from('# Dari berkas\n\nIsi.\n')
    });
    await page.waitForFunction(() => window.MarkRust.getPath() === 'runtime.md');
    assert.equal(await page.locator('#sb-file').textContent(), 'runtime.md');
    await page.locator('.ql-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Tambahan.');
    await page.waitForFunction(() => window.MarkRust.isDirty());
    await page.waitForTimeout(1000);
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('markrust.draft.v1')));
    assert.match(draft.markdown, /Tambahan\./);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btn-save').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'runtime.md');
    const saved = await fs.readFile(await download.path(), 'utf8');
    assert.match(saved, /Tambahan\./);
    assert.equal(await page.evaluate(() => window.MarkRust.isDirty()), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('markrust.draft.v1')), null);
    assert.deepEqual(errors, []);
    await page.close();
  });

  await run('gambar remote: nol request sebelum izin dan hanya satu setelah izin', async () => {
    const { page, errors } = await openApp();
    const attempts = [];
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await page.route('https://images.example/**', async (route) => {
      attempts.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
    });
    const source = [
      '![tertahan](https://images.example/satu.png)', '',
      '<img src="https://images.example/raw.png" srcset="https://images.example/srcset.png 2x">', ''
    ].join('\n');
    await page.evaluate((md) => window.MarkRust.setMarkdown(md), source);
    await page.waitForTimeout(400);
    assert.equal(attempts.length, 0);
    assert.equal(await page.locator('img[data-mr-src]').count(), 1);
    assert.equal(await page.locator('.mr-raw-block').count(), 1);
    await page.locator('#sb-load-images').click();
    await page.waitForFunction(() => document.querySelectorAll('img[src^="https://images.example/"]').length === 1);
    assert.deepEqual(attempts, ['https://images.example/satu.png']);
    assert.deepEqual(errors, []);
    await page.close();
  });
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log('\nRingkasan validasi browser:', JSON.stringify(results, null, 2));
if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
