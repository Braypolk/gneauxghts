import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { currentScaleFixture } from './currentScaleFixture.mjs';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gneauxghts-timeline-run-')));
  mkdirSync(join(root, 'data')); mkdirSync(join(root, 'vault'));
  const marker = JSON.stringify({ kind: 'gneauxghts-current-scale-v2' });
  writeFileSync(join(root, 'run.json'), marker);
  writeFileSync(join(root, 'data/release-current-scale-fixture.json'), marker);
  return root;
}
test('native preflight admits a canonical contained disposable fixture', () => {
  const root = fixture();
  try { assert.equal(currentScaleFixture(root).root, root); } finally { rmSync(root, { recursive: true }); }
});
for (const name of ['vault', 'data', 'documents']) test(`native preflight rejects escaped ${name} before app launch`, () => {
  const root = fixture();
  const external = realpathSync(mkdtempSync(join(tmpdir(), 'gneauxghts-preflight-external-')));
  try {
    rmSync(join(root, name), { recursive: true, force: true });
    symlinkSync(external, join(root, name));
    assert.throws(() => currentScaleFixture(root), /symlinks/);
  } finally { rmSync(root, { recursive: true }); rmSync(external, { recursive: true }); }
});
test('native preflight rejects a nested fixture root', () => {
  const root = fixture();
  try { mkdirSync(join(root, 'gneauxghts-timeline-run-nested')); assert.throws(() => currentScaleFixture(join(root, 'gneauxghts-timeline-run-nested')), /direct temporary/); }
  finally { rmSync(root, { recursive: true }); }
});
