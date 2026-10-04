import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createWebDriverRequest, waitUntil } from './nativeTransport.mjs';

test('bounded waits preserve transient failures and cannot hang on a stalled probe', async () => {
  let calls = 0;
  assert.equal(await waitUntil(() => { if (++calls < 3) throw new Error('not ready'); return 'ready'; }, 'readiness', 200, 1), 'ready');
  await assert.rejects(waitUntil(() => new Promise(() => {}), 'stalled probe', 20), /stalled probe.*exceeded deadline/);
  await assert.rejects(waitUntil(() => { throw new Error('useful failure'); }, 'bad probe', 20, 1), /useful failure/);
});

test('WebDriver transport preserves protocol errors, request bodies and request deadlines', async () => {
  const server = createServer(async (req, res) => {
    if (req.url === '/hang') return;
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/protocol') res.end(JSON.stringify({ value: { error: 'invalid session', message: 'lost owner' } }));
    else if (req.url === '/http') { res.statusCode = 503; res.end(JSON.stringify({ value: 'unavailable' })); }
    else res.end(JSON.stringify({ value: { method: req.method, body: body ? JSON.parse(body) : null } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = createWebDriverRequest(server.address().port, 100);
  try {
    assert.deepEqual(await request('/ok', { text: 'test' }), { method: 'POST', body: { text: 'test' } });
    assert.deepEqual(await request('/ok', undefined, 'GET'), { method: 'GET', body: null });
    await assert.rejects(request('/protocol'), /invalid session/);
    await assert.rejects(request('/http'), /unavailable/);
    await assert.rejects(request('/hang'), /timeout|aborted/i);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
