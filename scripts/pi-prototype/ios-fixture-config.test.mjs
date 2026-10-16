import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareIosFixture } from './ios-fixture-config.mjs';

test('default and explicit owned ports bind listener inspection and native launch to the same IPv4 loopback endpoint', () => {
  for (const [env, port] of [[{}, 1443], [{ PI_PROTOTYPE_IOS_FIXTURE_PORT: '1443' }, 1443], [{ PI_PROTOTYPE_IOS_FIXTURE_PORT: '1446' }, 1446]]) {
    const inspected = [];
    const config = prepareIosFixture(env, value => { inspected.push(value); return []; });
    assert.deepEqual(inspected, [port]);
    assert.equal(config.port, port);
    assert.equal(config.url, `http://127.0.0.1:${port}`);
    assert.deepEqual(config.launchEnv, { SIMCTL_CHILD_PI_PROTOTYPE_HTTP_FIXTURE: config.url });
    assert(Object.isFrozen(config) && Object.isFrozen(config.launchEnv));
  }
});

test('unexpected or malformed port values fail before inspecting any listener', () => {
  for (const value of ['', '1442', '1444', '4445', '1445', '0', '65536', '-1', '1446.0', '1.446e3', '01446', ' 1446', '1446\n', '1446/path', 'http://127.0.0.1:1446', 1446, null]) {
    assert.throws(() => prepareIosFixture({ PI_PROTOTYPE_IOS_FIXTURE_PORT: value }, () => {
      assert.fail('Invalid port reached listener inspection');
    }), /must be exactly 1443 or 1446/);
  }
});

test('an occupied selected port fails without changing or terminating its owner', () => {
  for (const port of [1443, 1446]) {
    const owners = [1234];
    assert.throws(() => prepareIosFixture({ PI_PROTOTYPE_IOS_FIXTURE_PORT: String(port) }, value => {
      assert.equal(value, port); return owners;
    }), new RegExp(`Fixture port ${port} has an unrelated owner; do not terminate it`));
    assert.deepEqual(owners, [1234]);
  }
});

// Read source instead of importing the interactive driver, whose top level
// deliberately owns native execution. Keep both entry points on the helper.
test('both iOS drivers use the validated port and matching launch environment', () => {
  for (const file of ['ios-interactive-gate.mjs', 'ios-transcript-gate.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /prepareIosFixture\(process\.env, listenerPids\)/);
    assert.match(source, /startInteractiveFixture\(fixtureConfig\.port[,) ]/);
    assert.match(source, /\.\.\.fixtureConfig\.launchEnv/);
    assert.doesNotMatch(source, /1443|1446|SIMCTL_CHILD_PI_PROTOTYPE_HTTP_FIXTURE/);
    assert(source.indexOf('prepareIosFixture(process.env, listenerPids)') < source.indexOf("run('xcrun'"));
  }
});
