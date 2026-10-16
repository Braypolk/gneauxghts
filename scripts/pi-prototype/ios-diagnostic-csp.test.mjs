import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { iosDiagnosticCsp } from './ios-diagnostic-csp.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const config = read('./tauri.prototype.conf.json');
const security = read('../../src-tauri/tauri.conf.json').app.security;
const gates = { PI_PROTOTYPE_DIAGNOSTICS: 'true', PI_PROTOTYPE_EXPANDED_GATE: 'true' };

test('packaged expanded iOS diagnostics admit only exact selected loopback control routes while retaining production directives', () => {
  const original = JSON.stringify({ config, security });
  for (const port of ['1443', '1446']) {
    const built = iosDiagnosticCsp(config, security.csp, 'ios', { ...gates, PI_PROTOTYPE_IOS_FIXTURE_PORT: port });
    const { 'connect-src': connect, ...other } = built.app.security.csp;
    const { 'connect-src': inherited, ...production } = security.csp;
    assert.deepEqual(other, production);
    assert.deepEqual(connect.split(' '), [...inherited.split(' '), `http://127.0.0.1:${port}/__pi_supplemental_evidence`,
      `http://127.0.0.1:${Number(port) + 1}/pi-suspension/`, `http://127.0.0.1:${Number(port) + 1}/pi-ios-publication/`]);
    assert.equal(built.app.windows, config.app.windows);
    assert.equal(built.build, config.build);
    assert.equal(built.app.security.devCsp, undefined);
  }
  assert.equal(JSON.stringify({ config, security }), original);
});

test('production, manual evaluation, desktop and non-expanded simulator builds retain their original configuration', () => {
  for (const mode of ['desktop', 'installed', 'build', 'diagnostics', 'interactive-gate', 'ios-interactive-gate'])
    assert.equal(iosDiagnosticCsp(config, security.csp, mode, gates), config);
  for (const env of [{}, { PI_PROTOTYPE_DIAGNOSTICS: 'true' }, { PI_PROTOTYPE_EXPANDED_GATE: 'true' },
    ...['false', '1', true].flatMap(value => [{ ...gates, PI_PROTOTYPE_DIAGNOSTICS: value }, { ...gates, PI_PROTOTYPE_EXPANDED_GATE: value }])])
    assert.equal(iosDiagnosticCsp(config, security.csp, 'ios', env), config);
  assert.match(iosDiagnosticCsp(config, security.csp, 'ios', gates).app.security.csp['connect-src'], /127\.0\.0\.1:1444\/pi-suspension\//);
  assert.doesNotMatch(iosDiagnosticCsp(config, security.csp, 'ios', gates).app.security.csp['connect-src'], /1446|1447/);
});

test('diagnostic packaging uses the same closed port vocabulary as native launch', () => {
  for (const port of ['8080', '1444', '1447', '1446/path', '01446', '', null, 1446])
    assert.throws(() => iosDiagnosticCsp(config, security.csp, 'ios', { ...gates, PI_PROTOTYPE_IOS_FIXTURE_PORT: port }), /exactly 1443 or 1446/);
  assert.throws(() => iosDiagnosticCsp(config, null, 'ios', gates), /existing production CSP/);
});

test('the actual iOS build passes this diagnostic configuration to native custom-protocol packaging', () => {
  const source = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  assert.match(source, /const nativeConfig = iosDiagnosticCsp\(windowConfig,[\s\S]*?app\.security\.csp, mode, process\.env\)/);
  assert.match(source, /writeFileSync\(config, JSON\.stringify\(nativeConfig\)\)/);
  assert.match(source, /TAURI_CONFIG: readFileSync\(config, 'utf8'\)/);
});
