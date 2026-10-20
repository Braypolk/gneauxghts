import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admitNativePresentation, foregroundNativeSpecs } from './nativePresentation.mjs';
import { nativeSuites } from './nativeSuite.mjs';
import { spawnSync } from 'node:child_process';

test('ordinary native smoke and live lanes do not require desktop activation', () => {
  for (const lane of ['smoke', 'live', 'hosted', 'subscription']) {
    assert.doesNotThrow(() => admitNativePresentation(nativeSuites[lane].map(name => `${name}.spec.ts`), {}));
  }
});

test('foreground CLI entry points reject before fixture preparation or app launch', () => {
  const env = {...process.env};
  delete env.GNEAUXGHTS_E2E_FOREGROUND;
  for (const args of [
    ['e2e/support/nativeSuite.mjs', 'foreground'],
    ['e2e/support/nativeSuite.mjs', 'measurement'],
    ['e2e/support/windowRestore.mjs'],
    ['e2e/support/currentScaleNative.mjs', '/missing-fixture']
  ]) {
    const result = spawnSync(process.execPath, args, {env, encoding: 'utf8', timeout: 5000});
    assert.ifError(result.error);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /No native app was launched/);
  }
});

test('focus-dependent specs and measurements fail before launch without explicit opt-in', () => {
  for (const name of foregroundNativeSpecs) {
    assert.throws(() => admitNativePresentation([[`e2e/specs/native/${name}.spec.ts`]], {}), /No native app was launched/);
    assert.doesNotThrow(() => admitNativePresentation([`${name}.spec.ts`], {GNEAUXGHTS_E2E_FOREGROUND: '1'}));
  }
  for (const key of ['GNEAUXGHTS_E2E_SUSTAINED_MEASUREMENT', 'GNEAUXGHTS_RELEASE_SCALE_RUN']) {
    assert.throws(() => admitNativePresentation([], {[key]: '1'}), /requires actual OS focus/);
  }
  for (const spec of ['./specs/native/**/*.spec.ts', 'editing-window-native-scale.spec.ts', 'markdown-marker-merge.spec.ts']) {
    assert.throws(() => admitNativePresentation([spec], {}), /requires actual OS focus/);
  }
});
