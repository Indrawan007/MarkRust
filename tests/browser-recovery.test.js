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

function fakeLocks() {
  const held = new Map();
  return {
    async query() { return { held: [...held.keys()].map((name) => ({ name })) }; },
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null);
      held.set(name, true);
      try { return await callback({ name }); } finally { held.delete(name); }
    }
  };
}

test('cleanup refuses live sessions and changed archives, deletes only selected inactive bytes', async () => {
  const { dom, storage } = setup();
  const locks = fakeLocks();
  const active = createBrowserRecovery(storage, 'active', locks);
  const cleaner = createBrowserRecovery(storage, 'cleaner', locks);
  try {
    await active.write({ markdown: 'keep active' });
    const key = BROWSER_SESSION_PREFIX + 'active';
    const raw = storage.getItem(key);
    assert.equal((await cleaner.list()).find((row) => row.id === key).canDelete, false);
    await assert.rejects(cleaner.remove(key, raw), /masih aktif/);
    await assert.rejects(active.remove(key, raw), /tidak boleh dihapus/);
    active.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal((await cleaner.list()).find((row) => row.id === key).canDelete, true);
    storage.setItem(key, 'changed');
    await assert.rejects(cleaner.remove(key, raw), /berubah/);
    assert.equal(storage.getItem(key), 'changed');
    storage.setItem(DRAFT_KEY, 'corrupt legacy');
    await cleaner.remove(DRAFT_KEY, await cleaner.inspect(DRAFT_KEY));
    assert.equal(storage.getItem(DRAFT_KEY), null);
    assert.equal(storage.getItem(key), 'changed');
    await cleaner.remove(key, 'changed');
    assert.equal(storage.getItem(key), null);
  } finally { active.dispose(); cleaner.dispose(); dom.window.close(); }
});

test('browser without Web Locks cannot delete archive sessions', async () => {
  const { dom, storage } = setup();
  try {
    storage.setItem(BROWSER_SESSION_PREFIX + 'old', 'corrupt');
    const cleaner = createBrowserRecovery(storage, 'cleaner', null);
    assert.equal((await cleaner.list())[0].canDelete, false);
    await assert.rejects(cleaner.remove(BROWSER_SESSION_PREFIX + 'old', 'corrupt'), /Web Locks/);
    assert.equal(storage.getItem(BROWSER_SESSION_PREFIX + 'old'), 'corrupt');
  } finally { dom.window.close(); }
});
