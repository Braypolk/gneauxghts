import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluationRoot } from './evaluation-data.mjs';

test('installed and runner use the isolated macOS native app-data identity', () => {
  assert.equal(evaluationRoot({}, 'darwin', '/Users/example'),
    '/Users/example/Library/Application Support/com.braypolkinghorne.gneauxghts.pi-prototype');
});
test('explicit disposable root remains stable and requires an absolute path', () => {
  assert.equal(evaluationRoot({ PI_PROTOTYPE_DATA: '/private/tmp/evaluation' }), '/private/tmp/evaluation');
  assert.throws(() => evaluationRoot({ PI_PROTOTYPE_DATA: '../ordinary' }), /absolute/);
});

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('desktop runner uses normal UI and one persistent root without invoking diagnostics', () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'pi-runner-test-')));
  const bin = join(temporary, 'bin');
  const root = join(temporary, 'data');
  const capture = join(temporary, 'capture.json');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8'));
fs.writeFileSync(process.env.PI_TEST_CAPTURE, JSON.stringify({ args, config, vite: process.env.VITE_PI_PROTOTYPE, foreground: process.env.GNEAUXGHTS_E2E_FOREGROUND }));
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PI_PROTOTYPE_DATA: root, PI_TEST_CAPTURE: capture };
  delete env.PI_PROTOTYPE_HTTP_FIXTURE;
  delete env.PI_PROTOTYPE_UI_GATE;
  delete env.PI_PROTOTYPE_FAULT;
  delete env.PI_PROTOTYPE_DIAGNOSTICS;
  try {
    for (let launch = 0; launch < 2; launch++) {
      const result = spawnSync(process.execPath, ['scripts/pi-prototype/run.mjs', 'desktop'], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const invocation = JSON.parse(readFileSync(capture, 'utf8'));
      assert.equal(invocation.config.app.windows[0].url, '/');
      assert.match(invocation.config.app.windows[0].title, /Pi Evaluation/);
      assert.equal(invocation.config.identifier, 'com.braypolkinghorne.gneauxghts.pi-prototype');
      assert.equal(invocation.vite, 'true');
      assert.equal(invocation.foreground, '1');
      assert.equal(invocation.args[invocation.args.indexOf('--features') + 1], 'pi-prototype,e2e-wdio');
      assert.equal(invocation.args[invocation.args.indexOf('--e2e-app-data-root') + 1], root);
      assert.ok(existsSync(join(root, 'pi-evaluation.json')));
    }
    const built = spawnSync(process.execPath, ['scripts/pi-prototype/run.mjs', 'build'], { env, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const buildInvocation = JSON.parse(readFileSync(capture, 'utf8'));
    assert.equal(buildInvocation.args[buildInvocation.args.indexOf('--features') + 1], 'pi-prototype');
    assert.equal(buildInvocation.args[buildInvocation.args.indexOf('--bundles') + 1], 'app');
    assert.equal(buildInvocation.config.app.windows[0].url, '/');
    const installed = spawnSync(process.execPath, ['scripts/pi-prototype/run.mjs', 'installed'], { env, encoding: 'utf8' });
    assert.notEqual(installed.status, 0);
    assert.match(installed.stderr, /native default root/);
    const refused = spawnSync(process.execPath, ['scripts/pi-prototype/run.mjs', 'desktop'], {
      env: { ...env, PI_PROTOTYPE_HTTP_FIXTURE: 'http://127.0.0.1:1443' }, encoding: 'utf8'
    });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /forbidden for manual evaluation/);
    const gate = spawnSync(process.execPath, ['scripts/pi-prototype/run.mjs', 'gate'], { env, encoding: 'utf8' });
    assert.notEqual(gate.status, 0);
    assert.match(gate.stderr, /empty disposable root/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
