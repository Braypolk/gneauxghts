import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Rebuild real Rust code using the application's library targets and profiles.
// macOS's unpacked debug information leaves new .o files after every edit.
test('macOS edit/build/test cycles do not accumulate loose debug objects', {
  skip: process.platform !== 'darwin',
  timeout: 120_000
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'gneaux-build-artifacts-'));
  try {
    const appManifest = readFileSync(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8');
    const tables = appManifest.split(/(?=^\[)/m);
    const library = tables.find(table => table.startsWith('[lib]'));
    assert(library, 'Application library configuration is required');
    const profiles = tables.filter(table => table.startsWith('[profile.'));
    writeFileSync(join(root, 'Cargo.toml'), [
      '[package]\nname = "build_artifact_probe"\nversion = "0.1.0"\nedition = "2021"\n',
      '[workspace]\n', library, ...profiles
    ].join('\n'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/main.rs'), 'fn main() { println!("{}", gneauxghts_lib::value()); }\n');

    let initialBytes;
    for (let revision = 0; revision < 6; revision++) {
      const functions = Array.from({ length: 64 }, (_, i) =>
        `#[inline(never)] pub fn f${i}() -> usize { ${i} + ${revision} }`).join('\n');
      const sum = Array.from({ length: 64 }, (_, i) => `f${i}()`).join(' + ');
      writeFileSync(join(root, 'src/lib.rs'), `${functions}\npub fn value() -> usize { ${sum} }\n` +
        `#[test] fn value_matches() { assert_eq!(value(), ${2016 + 64 * revision}); }\n`);
      for (const args of [['build'], ['test', '--lib']]) {
        const env = { ...process.env };
        // Keep this isolated fixture out of externally shared Cargo output.
        delete env.CARGO_TARGET_DIR;
        delete env.CARGO_BUILD_TARGET_DIR;
        delete env.CARGO_BUILD_BUILD_DIR;
        const result = spawnSync('cargo', [...args, '--offline', '--manifest-path', join(root, 'Cargo.toml'),
          '--target-dir', join(root, 'target')], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
      }

      const deps = join(root, 'target/debug/deps');
      const entries = readdirSync(deps);
      assert.equal(entries.filter(name => name.endsWith('.o')).length, 0,
        `Edit ${revision} retained loose object files`);
      assert(entries.some(name => name.endsWith('.dSYM')), 'Packed debugging symbols must remain available');
      const bytes = directoryBytes(deps);
      initialBytes ??= bytes;
      assert(bytes <= initialBytes * 1.1, 'Repeated edits must keep dependency output size stable');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function directoryBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(directory, entry.name);
    return sum + (entry.isDirectory() ? directoryBytes(path) : statSync(path).size);
  }, 0);
}
