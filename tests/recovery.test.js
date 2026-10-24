import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiskRecovery } from '../ui/core/recovery.js';

test('disk recovery serializes writes and clear after a pending snapshot', async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const disk = createDiskRecovery({ core: { invoke: async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'write_recovery') await gate;
  } } });
  const write = disk.write({ markdown: 'snapshot', path: null });
  const clear = disk.clear();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0][1].contents).version, 1);
  release();
  await Promise.all([write, clear]);
  assert.deepEqual(calls.map(([cmd]) => cmd), ['write_recovery', 'clear_recovery']);
});

test('disk queue recovers after a failed write and validates reads', async () => {
  let fail = true;
  const disk = createDiskRecovery({ core: { invoke: async (cmd) => {
    if (cmd === 'write_recovery' && fail) throw new Error('disk full');
    return JSON.stringify({ version: 1, markdown: '', path: null });
  } } });
  await assert.rejects(disk.write({ markdown: 'a' }), /disk full/);
  fail = false;
  await disk.write({ markdown: 'b' });
  assert.equal((await disk.read()).markdown, '');
});

test('listing and selecting recoveries uses serialized native commands', async () => {
  const calls = [];
  const disk = createDiskRecovery({ core: { invoke: async (cmd, args) => {
    calls.push([cmd, args]);
    return cmd === 'list_recoveries' ? JSON.stringify([{ id: 'session-1', path: null }]) : null;
  } } });
  assert.equal((await disk.list())[0].id, 'session-1');
  await disk.select('session-1');
  assert.deepEqual(calls.map(([cmd]) => cmd), ['list_recoveries', 'select_recovery']);
  assert.deepEqual(calls[1][1], { id: 'session-1' });
});

test('select returns an imported snapshot without clearing the source archive', async () => {
  const source = JSON.stringify({ version: 1, markdown: 'archive', path: '/old.md' });
  const commands = [];
  const disk = createDiskRecovery({ core: { invoke: async (command) => {
    commands.push(command);
    if (command === 'select_recovery') return source;
    return null;
  } } });
  assert.equal((await disk.select('session-old')).markdown, 'archive');
  await disk.write({ markdown: 'new work' });
  await disk.clear();
  assert.deepEqual(commands, ['select_recovery', 'write_recovery', 'clear_recovery']);
  assert.equal(JSON.parse(source).markdown, 'archive');
});

test('archive deletion is serialized and sends only the selected ID', async () => {
  const calls = [];
  const store = createDiskRecovery({ core: { invoke: async (cmd, args) => { calls.push([cmd, args]); } } });
  await store.remove('session-old');
  assert.deepEqual(calls, [['delete_recovery', { id: 'session-old' }]]);
});
