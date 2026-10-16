import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iosBuildFeatures } from './ios-build-features.mjs';

test('ordinary simulator builds retain their existing feature set', () => {
  assert.equal(iosBuildFeatures({}), 'pi-prototype,tauri/custom-protocol');
  assert.equal(iosBuildFeatures({ PI_PROTOTYPE_IOS_CRASH_FIXTURES: 'false' }), 'pi-prototype,tauri/custom-protocol');
});
test('crash hooks require both explicit expanded and diagnostic grants', () => {
  const env = { PI_PROTOTYPE_IOS_CRASH_FIXTURES: 'true', PI_PROTOTYPE_DIAGNOSTICS: 'true', PI_PROTOTYPE_EXPANDED_GATE: 'true' };
  assert.equal(iosBuildFeatures(env), 'pi-prototype,e2e-chat-fixture,tauri/custom-protocol');
  for (const field of Object.keys(env)) {
    assert.throws(() => iosBuildFeatures({ ...env, [field]: 'invalid' }), /explicit expanded disposable diagnostics/);
  }
});
