import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createBrowserRecovery, BROWSER_SESSION_PREFIX } from '../ui/core/browser-recovery.js';
import { DRAFT_KEY } from '../ui/core/drafts.js';

function setup() {
  const dom = new JSDOM('', { url: 'https://markrust.test' });
  return { dom, storage: dom.window.localStorage };
}

test('new session writes/clear never mutate deferred legacy, corrupt, or old session archives', async () => {
  const { dom, storage } = setup();
  try {
    const old = JSON.stringify({ version: 1, markdown: 'old', savedAt: 1 });
    storage.setItem(DRAFT_KEY, old);
    storage.setItem(BROWSER_SESSION_PREFIX + 'old', old);
    storage.setItem(BROWSER_SESSION_PREFIX + 'corrupt', '{broken');
    const recovery = createBrowserRecovery(storage, 'fresh');
    const rows = await recovery.list();
    assert.equal(rows.length, 3);
    assert.equal(rows.find((row) => row.id.endsWith('corrupt')).corrupt, true);
    assert.equal((await recovery.select(DRAFT_KEY)).markdown, 'old');
    await recovery.write({ markdown: 'new' });
    assert.equal((await recovery.read()).markdown, 'new');
    assert.equal((await recovery.list()).length, 3);
    await recovery.clear();
    assert.equal(storage.getItem(DRAFT_KEY), old);
    assert.equal(storage.getItem(BROWSER_SESSION_PREFIX + 'old'), old);
    assert.equal(storage.getItem(BROWSER_SESSION_PREFIX + 'corrupt'), '{broken');
    assert.equal(storage.getItem(BROWSER_SESSION_PREFIX + 'fresh'), null);
  } finally { dom.window.close(); }
});

test('next page can import previous session without adopting or deleting it', async () => {
  const { dom, storage } = setup();
  try {
    const first = createBrowserRecovery(storage, 'first');
    await first.write({ markdown: '' });
    const second = createBrowserRecovery(storage, 'second');
    const rows = await second.list();
    assert.equal(rows.length, 1);
    assert.equal((await second.select(rows[0].id)).markdown, '');
    await second.write({ markdown: 'edited' });
    await second.clear();
    assert.equal((await first.read()).markdown, '');
    await assert.rejects(second.select('markrust.toolbar.pinned'), /tidak valid/);
    await assert.rejects(second.select(BROWSER_SESSION_PREFIX + 'missing'), /tidak tersedia/);
  } finally { dom.window.close(); }
});

test('quota, blocked storage and session ID collision fail without destroying original bytes', async () => {
  const { dom, storage } = setup();
  try {
    const key = BROWSER_SESSION_PREFIX + 'collision';
    storage.setItem(key, 'source');
    const duplicate = createBrowserRecovery(storage, 'collision');
    await assert.rejects(duplicate.write({ markdown: 'bad' }), /sudah dipakai/);
    await duplicate.clear();
    assert.equal(storage.getItem(key), 'source');
    await assert.rejects(createBrowserRecovery(null).list(), /tidak tersedia/);
    const quota = createBrowserRecovery({ getItem: () => null, setItem() { throw new Error('quota'); } });
    await assert.rejects(quota.write({ markdown: 'new' }), /quota/);
  } finally { dom.window.close(); }
});
