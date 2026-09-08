import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { nativeE2EBinary, pinNativeE2EBinary } from './nativeE2EBinary.mjs';

const e2eBytes = Buffer.from('--e2e-app-data-root --e2e-documents-root --e2e-vault-root TAURI_WEBDRIVER_PORT');
const ordinaryBytes = Buffer.from('ordinary executable without E2E override handling');
function fixture(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gneauxghts-binary-preflight-')));
  try { run(root); } finally { rmSync(root, { recursive: true }); }
}

test('an ordinary Cargo overwrite cannot replace an admitted copied E2E artifact', () => fixture(root => {
  const source = join(root, 'cargo-output');
  const copy = join(root, 'e2e-copy');
  writeFileSync(source, e2eBytes);
  const admitted = pinNativeE2EBinary(source, copy, 'release');
  writeFileSync(source, ordinaryBytes);
  assert.deepEqual(readFileSync(copy), e2eBytes);
  assert.equal(nativeE2EBinary('release', copy).sha256, admitted.sha256);
  assert.throws(() => nativeE2EBinary('release', source), /ENOENT/);
  assert.throws(() => pinNativeE2EBinary(source, copy, 'release'), /lacks compiled E2E marker/);
  assert.equal(nativeE2EBinary('release', copy).sha256, admitted.sha256);
}));

test('ordinary, modified and wrong-profile artifacts fail before any launch', () => fixture(root => {
  const binary = join(root, 'binary');
  writeFileSync(binary, ordinaryBytes);
  writeFileSync(`${binary}.build.json`, JSON.stringify({ kind: 'gneauxghts-native-e2e-v1', profile: 'release', features: ['e2e-wdio'], sha256: createHash('sha256').update(ordinaryBytes).digest('hex') }));
  assert.throws(() => nativeE2EBinary('release', binary), /lacks compiled E2E marker/);
  writeFileSync(binary, e2eBytes);
  const copy = join(root, 'copy');
  pinNativeE2EBinary(binary, copy, 'debug');
  assert.throws(() => nativeE2EBinary('release', copy), /profile mismatch/);
  assert.equal(nativeE2EBinary('debug', copy).manifest.profile, 'debug');
  writeFileSync(copy, Buffer.concat([e2eBytes, Buffer.from('modified')]));
  assert.throws(() => nativeE2EBinary('debug', copy), /hash changed/);
}));
