import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// Preflight before launching any writer, including the app's ordinary startup.
export function currentScaleFixture(path) {
  const root = resolve(path);
  assert.equal(realpathSync(root), root, 'Fixture root must be canonical, without symlink aliases');
  assert.equal(dirname(root), realpathSync(tmpdir()), 'Fixture must be a direct temporary-directory child');
  assert(basename(root).startsWith('gneauxghts-timeline-run-'));
  function inspect(path) {
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), 'Disposable fixture must not contain symlinks');
    if (stat.isDirectory()) for (const name of readdirSync(path)) inspect(join(path, name));
    else assert(stat.isFile(), 'Disposable fixture contains an unsupported file type');
  }
  inspect(root);
  for (const name of ['vault', 'data']) assert(lstatSync(join(root, name)).isDirectory());
  if (existsSync(join(root, 'documents'))) assert(lstatSync(join(root, 'documents')).isDirectory());
  const marker = JSON.parse(readFileSync(join(root, 'run.json'), 'utf8'));
  const fixture = JSON.parse(readFileSync(join(root, 'data/release-current-scale-fixture.json'), 'utf8'));
  assert.equal(marker.kind, 'gneauxghts-current-scale-v2');
  assert.equal(fixture.kind, marker.kind);
  return { root, marker, fixture };
}
