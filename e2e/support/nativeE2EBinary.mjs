import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const kind = 'gneauxghts-native-e2e-v1';
const markers = ['--e2e-app-data-root', '--e2e-documents-root', '--e2e-vault-root', 'TAURI_WEBDRIVER_PORT'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function assertProfile(profile) { assert(['release', 'debug'].includes(profile), 'Native E2E profile must be release or debug'); }
function assertMarkers(bytes) {
  for (const marker of markers) assert(bytes.includes(Buffer.from(marker)), `Native executable lacks compiled E2E marker ${marker}`);
}

export function nativeE2EPath(profile) {
  assertProfile(profile);
  return resolve('src-tauri', 'target', 'e2e', profile, process.platform === 'win32' ? 'gneauxghts.exe' : 'gneauxghts');
}

// Ordinary Cargo commands replace target/{release,debug}/gneauxghts. Native
// launchers admit only the separately copied E2E artifact or an explicit copy.
export function nativeE2EBinary(profile, path = nativeE2EPath(profile)) {
  assertProfile(profile);
  const binary = resolve(path);
  assert.equal(realpathSync(binary), binary, 'Pinned executable must be canonical');
  assert(lstatSync(binary).isFile());
  const manifest = JSON.parse(readFileSync(`${binary}.build.json`, 'utf8'));
  assert.equal(manifest.kind, kind);
  assert.equal(manifest.profile, profile, 'Native E2E build profile mismatch');
  assert.deepEqual(manifest.features, ['e2e-wdio']);
  const bytes = readFileSync(binary);
  const hash = sha256(bytes);
  assert.equal(hash, manifest.sha256, 'Pinned native binary hash changed');
  assertMarkers(bytes);
  return { binary, sha256: hash, manifest };
}

// Called immediately after buildNative's successful feature build, before any
// other Cargo command can overwrite its output. No application is launched.
export function pinNativeE2EBinary(source, destination, profile) {
  assertProfile(profile);
  const bytes = readFileSync(source);
  assertMarkers(bytes);
  const binary = resolve(destination);
  mkdirSync(dirname(binary), { recursive: true });
  assert.equal(realpathSync(dirname(binary)), dirname(binary), 'Pinned directory must be canonical');
  for (const path of [binary, `${binary}.build.json`]) {
    assert(!lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink(), 'Pinned artifact must not be a symlink');
  }
  copyFileSync(source, binary);
  const manifest = { kind, profile, features: ['e2e-wdio'], sha256: sha256(bytes), buildCommand: `node e2e/support/buildNative.mjs${profile === 'release' ? ' --release' : ''}` };
  writeFileSync(`${binary}.build.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return nativeE2EBinary(profile, binary);
}
