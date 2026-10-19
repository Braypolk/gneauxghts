import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { nodeRuntimeLicense } from '../../scripts/buildChatgptAuth.mjs';

for (const [layout, executable, notices] of [
  ['archive', 'bin/node', 'LICENSE'],
  ['flat Windows', 'nodejs/node.exe', 'nodejs/LICENSE'],
  ['flat text license', 'nodejs/node.exe', 'nodejs/LICENSE.txt'],
  ['Homebrew', 'bin/node', 'share/doc/node/LICENSE'],
  ['system package', 'bin/node', 'share/doc/nodejs/copyright']
]) test(`auth packaging finds Node notices in a ${layout} installation`, () => {
  const root = mkdtempSync(join(tmpdir(), 'gneaux-node-license-'));
  try {
    const license = join(root, notices);
    mkdirSync(dirname(license), { recursive: true });
    writeFileSync(license, 'synthetic license fixture');
    assert.equal(nodeRuntimeLicense(join(root, executable), ''), license);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('custom Node notices are explicit and a missing override never silently falls back', () => {
  const root = mkdtempSync(join(tmpdir(), 'gneaux-node-license-'));
  try {
    const license = join(root, 'custom-notices');
    writeFileSync(license, 'synthetic license fixture');
    const runtime = join(root, 'bin/node');
    assert.equal(nodeRuntimeLicense(runtime, license), license);
    assert.throws(() => nodeRuntimeLicense(runtime, join(root, 'missing')), /GNEAUXGHTS_NODE_LICENSE/);
    assert.throws(() => nodeRuntimeLicense(runtime, ''), /GNEAUXGHTS_NODE_LICENSE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
