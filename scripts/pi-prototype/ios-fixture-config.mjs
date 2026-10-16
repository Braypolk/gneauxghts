import assert from 'node:assert/strict';

// Diagnostic drivers share the existing default, or explicitly use the alternate
// fixture port reserved for an owned iOS gate while the desktop gate continues.
// This module is inert: the caller supplies the listener inspection function.
export function prepareIosFixture(env, listenerPids) {
  const value = env.PI_PROTOTYPE_IOS_FIXTURE_PORT === undefined ? '1443' : env.PI_PROTOTYPE_IOS_FIXTURE_PORT;
  assert(value === '1443' || value === '1446',
    'PI_PROTOTYPE_IOS_FIXTURE_PORT must be exactly 1443 or 1446');
  const port = Number(value);
  assert.equal(listenerPids(port).length, 0, `Fixture port ${port} has an unrelated owner; do not terminate it`);
  const url = `http://127.0.0.1:${port}`;
  return Object.freeze({ port, url,
    launchEnv: Object.freeze({ SIMCTL_CHILD_PI_PROTOTYPE_HTTP_FIXTURE: url }) });
}
