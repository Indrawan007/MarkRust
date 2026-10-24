import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// File-only fixtures, not a claim of actual Arch/Hyprland GUI compatibility.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'markrust-local-'));
  for (const path of ['scripts', 'target/release', 'src-tauri/icons', 'home', 'tools']) mkdirSync(join(root, path), { recursive: true });
  copyFileSync(new URL('../scripts/arch-local.sh', import.meta.url), join(root, 'scripts/arch-local.sh'));
  writeFileSync(join(root, 'src-tauri/icons/128x128.png'), 'fixture icon');
  const binary = join(root, 'target/release/markrust');
  writeFileSync(binary, '#!/bin/sh\necho version-one\n', { mode: 0o755 });
  const home = join(root, 'home');
  const bin = join(home, 'bin with spaces');
  const data = join(home, 'share');
  const env = { ...process.env, HOME: home, MARKRUST_BIN_DIR: bin, XDG_DATA_HOME: data };
  return { root, binary, bin, data, env,
    run(...args) { return spawnSync('bash', [join(root, 'scripts/arch-local.sh'), ...args], { env, encoding: 'utf8', timeout: 10000 }); },
    cleanup() { rmSync(root, { recursive: true, force: true }); }
  };
}

test('local install, update, rollback and uninstall preserve user data', () => {
  const f = fixture();
  try {
    const recovery = join(f.data, 'com.markrust.app/recovery-v2');
    mkdirSync(recovery, { recursive: true });
    writeFileSync(join(recovery, 'keep'), 'important');
    let result = f.run('install');
    assert.equal(result.status, 0, result.stderr);
    const desktop = readFileSync(join(f.data, 'applications/com.markrust.app.desktop'), 'utf8');
    assert.ok(desktop.includes(`Exec="${f.bin}/markrust"`));
    assert.ok(!desktop.includes('sh -c'));
    writeFileSync(f.binary, '#!/bin/sh\necho version-two\n', { mode: 0o755 });
    result = f.run('install');
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(f.bin, 'markrust.previous'), 'utf8'), /version-one/);
    assert.equal(f.run('rollback').status, 0);
    assert.match(readFileSync(join(f.bin, 'markrust'), 'utf8'), /version-one/);
    assert.equal(f.run('uninstall').status, 0);
    assert.equal(existsSync(join(f.bin, 'markrust')), false);
    assert.equal(readFileSync(join(recovery, 'keep'), 'utf8'), 'important');
  } finally { f.cleanup(); }
});

test('refuses overwrite of an unmanaged binary', () => {
  const f = fixture();
  try {
    mkdirSync(f.bin, { recursive: true });
    writeFileSync(join(f.bin, 'markrust'), 'unrelated');
    assert.notEqual(f.run('install').status, 0);
    assert.equal(readFileSync(join(f.bin, 'markrust'), 'utf8'), 'unrelated');
  } finally { f.cleanup(); }
});

test('build uses fixed output and locked dependencies unless explicitly updated', () => {
  const f = fixture();
  try {
    const trace = join(f.root, 'cargo-args');
    writeFileSync(join(f.root, 'tools/cargo'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$TRACE"\n', { mode: 0o755 });
    f.env.PATH = join(f.root, 'tools') + ':' + process.env.PATH;
    f.env.TRACE = trace;
    assert.equal(f.run('build').status, 0);
    assert.match(readFileSync(trace, 'utf8'), /--locked/);
    assert.ok(readFileSync(trace, 'utf8').includes(join(f.root, 'target')));
    assert.equal(f.run('build', '--update-lock').status, 0);
    assert.ok(!readFileSync(trace, 'utf8').includes('--locked'));
    assert.notEqual(f.run('build', '--unknown').status, 0);
  } finally { f.cleanup(); }
});
