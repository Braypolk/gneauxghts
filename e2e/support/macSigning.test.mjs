import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signMacExecutable, withMacDevelopmentSigning } from '../../scripts/signMacExecutable.mjs';

test('native builds sign and verify the final executable using a stable certificate identity', () => {
  const calls = [];
  const signed = signMacExecutable('/tmp/test-app', { platform: 'darwin', identity: 'Apple Development: Example (TESTTEAM)', run: (command, args) => { calls.push([command, args]); return { status: 0 }; } });
  assert(signed);
  assert.deepEqual(calls, [
    ['codesign', ['--force', '--sign', 'Apple Development: Example (TESTTEAM)', '--identifier', 'com.braypolkinghorne.gneauxghts-e2e', '/tmp/test-app']],
    ['codesign', ['--verify', '--strict', '/tmp/test-app']]
  ]);
});

test('missing identities and other platforms do not change credential access rules', () => {
  const run = () => { throw new Error('must not run'); };
  assert.equal(signMacExecutable('/tmp/test-app', { platform: 'darwin', identity: '', run }), false);
  assert.equal(signMacExecutable('/tmp/test-app', { platform: 'linux', identity: 'Example', run }), false);
  assert.throws(() => signMacExecutable('/tmp/test-app', { platform: 'darwin', identity: '-', run }), /ad-hoc signing/);
});

test('signing failure stops before publishing a pinned executable', () => {
  const calls = [];
  assert.throws(() => signMacExecutable('/tmp/test-app', { platform: 'darwin', identity: 'Example', run: (...args) => { calls.push(args); return { status: 1 }; } }), /Unable to sign/);
  assert.equal(calls.length, 1);
});

test('development signing preserves Tauri and application arguments', () => {
  const args = ['dev', '--no-watch', '--', '--release', '--', 'app argument'];
  const configured = withMacDevelopmentSigning(args, 'Example', 'darwin');
  assert.deepEqual(configured.slice(0, 4), ['dev', '--no-watch', '--', '--config']);
  assert.match(configured[4], /runner=\["\/bin\/sh",/);
  assert.deepEqual(configured.slice(5), ['--release', '--', 'app argument']);
  assert.equal(withMacDevelopmentSigning(args, '', 'darwin'), args);
  assert.equal(withMacDevelopmentSigning(args, 'Example', 'linux'), args);
  assert.deepEqual(withMacDevelopmentSigning(['dev', '--help'], 'Example', 'darwin'), ['dev', '--help']);
  assert.throws(() => withMacDevelopmentSigning(['dev', '--runner=custom'], 'Example', 'darwin'), /default Cargo runner/);
});
