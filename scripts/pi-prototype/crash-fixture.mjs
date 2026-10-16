import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

export function crashReply(body, compatible) {
  const history = compatible ? body.messages : body.input;
  const user = history?.findLast(message => message.role === 'user');
  const marker = JSON.stringify(user).match(/PI_E2E_CRASH_([a-zA-Z0-9-]{8,64})/);
  if (!marker) throw new Error('Missing exact synthetic crash scope');
  const scope = marker[1], review = JSON.stringify(user).includes('PI_CRASH_REVIEW');
  const after = history.slice(history.indexOf(user) + 1);
  const output = after.some(item => item.role === 'tool' || item.type === 'function_call_output');
  return { scope, user, review, ...(review && !output ? { tool: { name: 'propose_note', arguments: JSON.stringify({ title: `PI_E2E_CRASH_${scope}`, markdown: `Synthetic crash review bytes PI_E2E_CRASH_${scope}.` }) } }
    : { text: review ? 'Synthetic crash review staging completed.' : `Synthetic terminal partial PI_E2E_CRASH_${scope}.` }) };
}

export async function startCrashFixture(port = 1443) {
  const requests = [], held = new Map(), attempts = new Map();
  const server = createServer(async (request, response) => {
    let record;
    try {
      if (request.headers.authorization) throw new Error('Synthetic crash fixture must never receive credentials');
      let raw = ''; for await (const part of request) { raw += part; if (raw.length > 262144) throw new Error('Synthetic request exceeds bound'); }
      const body = JSON.parse(raw), compatible = request.url === '/local/v1/chat/completions';
      if (!compatible && request.url !== '/openai/v1/responses') throw new Error('Unexpected synthetic route');
      const reply = crashReply(body, compatible);
      const key = `${request.url}:${reply.scope}`;
      const attempt = (attempts.get(key) ?? 0) + 1; attempts.set(key, attempt);
      record = { scope: reply.scope, path: request.url, model: body.model, attempt, review: reply.review, tool: reply.tool?.name, body, startedAt: Date.now(), completed: false };
      requests.push(record); response.on('close', () => { record.closedAt = Date.now(); });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = async event => { response.write(`data: ${JSON.stringify(event)}\n\n`); await delay(20); };
      const id = `crash_${requests.length}`;
      const hold = async () => {
        if (reply.review || attempt !== 1) return;
        record.partialSentAt = Date.now();
        let release, timeout; const ready = new Promise(resolve => { release = resolve; }); held.set(reply.scope, release);
        const expired = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('UI never acknowledged terminal partial')), 25000); });
        try { await Promise.race([ready, expired]); }
        finally { clearTimeout(timeout); held.delete(reply.scope); }
        record.releasedAt = Date.now();
      };
      if (compatible) {
        const chunk = delta => ({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] });
        await send(chunk({ role: 'assistant' }));
        await send(chunk(reply.tool ? { tool_calls: [{ index: 0, id, type: 'function', function: reply.tool }] } : { content: reply.text }));
        await hold();
        await send({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: reply.tool ? 'tool_calls' : 'stop' }] });
        response.end('data: [DONE]\n\n');
      } else {
        const item = reply.tool ? { type: 'function_call', id, call_id: id, name: reply.tool.name, arguments: '' }
          : { type: 'message', id, role: 'assistant', status: 'in_progress', content: [] };
        await send({ type: 'response.created', response: { id } }); await send({ type: 'response.output_item.added', output_index: 0, item });
        await send(reply.tool ? { type: 'response.function_call_arguments.delta', output_index: 0, delta: reply.tool.arguments }
          : { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: reply.text });
        await hold();
        const done = reply.tool ? { ...item, arguments: reply.tool.arguments, status: 'completed' }
          : { ...item, status: 'completed', content: [{ type: 'output_text', text: reply.text, annotations: [] }] };
        await send({ type: 'response.output_item.done', output_index: 0, item: done });
        await send({ type: 'response.completed', response: { id, status: 'completed', output: [done], usage: { input_tokens: 8, output_tokens: 8, total_tokens: 16 } } }); response.end();
      }
      record.completed = true; record.completedAt = Date.now();
    } catch (error) { if (record) record.error = String(error); else requests.push({ error: String(error) }); if (!response.headersSent) response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { requests, release: scope => { const resolve = held.get(scope); if (!resolve) throw new Error('Synthetic terminal stream is not held'); resolve(); },
    close: () => new Promise(resolve => { for (const release of held.values()) release(); server.close(resolve); server.closeAllConnections(); }) };
}
