import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

// Override to verify the desktop build's bundled helper through the same flows.
const helper = process.env.GNEAUXGHTS_AUTH_TEST_HELPER ?? 'scripts/chatgptAuth.mjs';

// The production entrypoint uses Pi's real refresh implementation. Only HTTP is
// controlled; no OAuth grant or secret is read from the developer's machine.
async function helperWithTokenResponse(response, request, status = 200) {
  const root = mkdtempSync(join(tmpdir(), 'gneaux-auth-test-'));
  const preload = join(root, 'http.mjs');
  writeFileSync(preload, `globalThis.fetch = async (url, options) => {
    if (url !== 'https://auth.openai.com/api/accounts/oauth/token' || options.method !== 'POST' || options.body.get('grant_type') !== 'refresh_token' || options.body.get('client_id') !== 'test-issued-client' || options.body.get('refresh_token') !== 'test-refresh') throw new Error('invalid refresh request');
    return new Response(JSON.stringify(${JSON.stringify(response)}), {status: ${status}, headers: {'content-type':'application/json'}});
  };`);
  const child = spawn(process.execPath, ['--import', preload, helper], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    child.stdin.write(`${JSON.stringify(request)}\n`);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    return { code, stderr, events: stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
  } finally { clearTimeout(deadline); child.stdin.destroy(); rmSync(root, { recursive: true, force: true }); }
}

test('Pi refresh rotates the token with the original issued client and retains subscription permission', async () => {
  const started = Date.now();
  const result = await helperWithTokenResponse({ access_token: 'test-new-access', refresh_token: 'test-rotated-refresh', expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct' }, { action: 'refresh', credential: { type: 'oauth', access: 'test-old-access', refresh: 'test-refresh', expires: 1, clientId: 'test-issued-client' } });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, 'credential');
  assert.deepEqual({ ...result.events[0].credential, expires: null }, { type: 'oauth', access: 'test-new-access', refresh: 'test-rotated-refresh', expires: null, clientId: 'test-issued-client', scopes: ['openid', 'chatgpt.tokens.use.direct'] });
  assert(result.events[0].credential.expires > started + 3_000_000);
});

test('a refresh without plan permission fails without echoing provider tokens', async () => {
  const result = await helperWithTokenResponse({ access_token: 'test-private-access', refresh_token: 'test-private-refresh', expires_in: 3600, scope: 'openid' }, { action: 'refresh', credential: { type: 'oauth', refresh: 'test-refresh', clientId: 'test-issued-client' } });
  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.events, [{ type: 'error', code: 'authentication_failed' }]);
});

test('revoked refresh permission requests sign-in without exposing the provider response', async () => {
  const result = await helperWithTokenResponse({ error: 'invalid_grant', error_description: 'private-provider-message' }, { action: 'refresh', credential: { type: 'oauth', refresh: 'test-refresh', clientId: 'test-issued-client' } }, 400);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.events, [{ type: 'error', code: 'reauthorization_required' }]);
});

for (const { status, error } of [
  { status: 429, error: 'rate_limit_exceeded' },
  { status: 503, error: 'server_error' },
  { status: 400, error: 'invalid_client' }
]) {
  test(`refresh ${error} does not request a new sign-in`, async () => {
    const result = await helperWithTokenResponse({ error, error_description: 'private-provider-message' }, { action: 'refresh', credential: { type: 'oauth', refresh: 'test-refresh', clientId: 'test-issued-client' } }, status);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.events, [{ type: 'error', code: 'authentication_failed' }]);
  });
}

async function loginScenario(mode, { clientId, omitCallbackClient = false, callbackClientId = 'test-issued-client' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gneaux-login-test-'));
  const preload = join(root, 'http.mjs');
  writeFileSync(preload, `globalThis.fetch = async (url, options) => {
    const body = options.body;
    if (url !== 'https://auth.openai.com/api/accounts/oauth/token' || body.get('grant_type') !== 'authorization_code' || body.get('client_id') !== 'test-issued-client' || body.get('code') !== 'test-code' || !body.get('code_verifier') || body.get('resource') !== 'https://api.openai.com/v1') throw new Error('invalid exchange');
    return new Response(JSON.stringify({ access_token:'test-access', refresh_token:'test-refresh', id_token:'test-id-token', expires_in:3600, scope:'openid chatgpt.tokens.use.direct' }), {headers:{'content-type':'application/json'}});
  };`);
  const child = spawn(process.execPath, ['--import', preload, helper], { stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  let buffer = '', stderr = '', authorization;
  const pending = [];
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
  child.stderr.on('data', value => { stderr += value; });
  child.stdout.on('data', value => {
    buffer += value;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const event = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      events.push(event);
      if (event.type === 'auth_url') authorization = new URL(event.url);
      if (event.type === 'manual_input') {
        const callback = new URL(authorization.searchParams.get('redirect_uri'));
        callback.search = new URLSearchParams({ code: 'test-code', ...(omitCallbackClient ? {} : { client_id: callbackClientId }), state: mode === 'bad-state' ? 'foreign-state' : authorization.searchParams.get('state') }).toString();
        if (mode === 'callback') pending.push(fetch(callback).then(response => { assert.equal(response.status, 200); return response.text(); }));
        else if (mode === 'cancel') child.stdin.end();
        else child.stdin.write(`${JSON.stringify({ action: 'manual_input', value: callback.toString() })}\n`);
      }
    }
  });
  try {
    child.stdin.write(`${JSON.stringify({ action:'login', deviceId:'11111111-1111-4111-8111-111111111111', clientId })}\n`);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    await Promise.all(pending);
    return { code, stderr, events };
  } finally { clearTimeout(deadline); child.stdin.destroy(); child.kill(); rmSync(root, { recursive: true, force: true }); }
}

for (const mode of ['callback', 'manual']) {
  test(`Pi browser login completes through ${mode} with curated progress`, async () => {
    const result = await loginScenario(mode);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.events.map(event => event.type), ['auth_url', 'manual_input', 'progress', 'credential']);
    assert.deepEqual(result.events[2], { type: 'progress', phase: 'completing' });
    assert.equal(result.events[3].credential.clientId, 'test-issued-client');
    assert.equal(result.events[3].credential.access, 'test-access');
    const authorization = new URL(result.events[0].url);
    assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(authorization.searchParams.get('agent_name_hint'), 'Gneauxghts');
    assert(!JSON.stringify(result.events.slice(0, -1)).includes('test-access'));
  });
}

test('Pi rejects a pasted callback for another sign-in without returning secrets', async () => {
  const result = await loginScenario('bad-state');
  assert.equal(result.events[0]?.type, 'auth_url');
  assert.equal(result.code, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.events.at(-1), { type: 'error', code: 'authentication_failed' });
  assert(!result.events.some(event => event.type === 'credential'));
});

test('reconnecting reuses the issued registration instead of creating another app', async () => {
  const result = await loginScenario('manual', { clientId: 'test-issued-client' });
  assert.equal(result.code, 0);
  const authorization = new URL(result.events[0].url);
  assert.equal(authorization.searchParams.get('client_id'), 'test-issued-client');
  assert.equal(authorization.searchParams.has('agent_name_hint'), false);
  assert.equal(authorization.searchParams.get('ext_agent_host_id'), 'urn:uuid:11111111-1111-4111-8111-111111111111');
  assert.equal(result.events.at(-1).credential.clientId, 'test-issued-client');
});

for (const mode of ['callback', 'manual']) {
  test(`returning ${mode} sign-in uses the saved client when the callback omits it`, async () => {
    const result = await loginScenario(mode, { clientId: 'test-issued-client', omitCallbackClient: true });
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.events.at(-1).credential.clientId, 'test-issued-client');
  });
}

for (const scenario of [
  { mode: 'manual', options: { clientId: 'test-issued-client', callbackClientId: 'foreign-client' } },
  { mode: 'bad-state', options: { clientId: 'test-issued-client', omitCallbackClient: true } },
  { mode: 'manual', options: { omitCallbackClient: true } },
  { mode: 'manual', options: { clientId: 'dynamic_agent_client' } }
]) {
  test(`rejects invalid registration/state: ${JSON.stringify(scenario)}`, async () => {
    const result = await loginScenario(scenario.mode, scenario.options);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.events.at(-1), { type: 'error', code: 'authentication_failed' });
    assert(!result.events.some(event => event.type === 'credential'));
  });
}

test('closing the native input cancels browser login and releases the callback port', async () => {
  const cancelled = await loginScenario('cancel');
  assert.equal(cancelled.events[0]?.type, 'auth_url');
  assert.equal(cancelled.code, 1);
  assert.equal(cancelled.stderr, '');
  assert.deepEqual(cancelled.events.at(-1), { type: 'error', code: 'authentication_failed' });
  // A second real Pi callback listener must be able to bind the same port.
  assert.equal((await loginScenario('manual')).code, 0);
});
