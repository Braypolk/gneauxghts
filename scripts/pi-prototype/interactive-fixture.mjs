import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { planFollowonsReply } from './followons-fixture.mjs';
import { createSupplementalEvidenceControl, planSupplementalEvidenceReply } from './supplemental-evidence-fixture.mjs';
import { planSupplementalReviewReply } from './supplemental-review-fixture.mjs';

export function planWorkspaceReply(body, compatible, attempt = 1, followons = false) {
  const reply = (followons ? planSupplementalEvidenceReply(body, compatible)
    ?? planSupplementalReviewReply(body, compatible)
    ?? planFollowonsReply(body, compatible, attempt) : undefined)
    ?? planInteractiveReply(body, compatible, attempt);
  return followons && reply.journey === 'INTERRUPT' && attempt === 1
    ? { ...reply, pause: false, holdUntilClosed: true } : reply;
}

/** Process interruption belongs to the driver's owned termination/teardown.
 * Longer UI journeys cannot let a guessed provider timer finish this request.
 * Call only after emitting the partial text, and never emit terminal frames.
 */
export async function holdInteractiveInterruption(record, res) {
  if (!Number.isFinite(record.firstTextAt)) throw new Error('Interruption hold must follow actual streamed text');
  if (record.completed) throw new Error('Cannot hold a completed interruption');
  record.interruptHeldAt = Date.now();
  await new Promise(resolve => {
    const closed = () => {
      record.interruptClosedAt = Date.now(); record.closed = true; record.closedAt ??= record.interruptClosedAt;
      resolve();
    };
    res.once('close', closed);
    if (res.destroyed) { res.removeListener('close', closed); closed(); }
  });
}

// Synthetic protocols for the ordinary workspace gate. No native state or
// authorization is replaced here: these are provider replies and tool requests.
export function planInteractiveReply(body, compatible, attempt = 1) {
  const history = compatible ? body.messages : body.input;
  if (!Array.isArray(history)) throw new Error('Missing provider history');
  const last = history.findLastIndex(item => item.role === 'user');
  const userMessage = history[last] ?? {};
  const user = JSON.stringify(userMessage);
  const prompt = typeof userMessage.content === 'string' ? userMessage.content : (userMessage.content ?? []).map(part => part.text ?? '').join('');
  const contextJson = prompt.match(/\n(\[[\s\S]*\])\n\nPI_UI:/)?.[1];
  const context = contextJson ? JSON.parse(contextJson) : [];
  const marker = user.match(/PI_UI:([A-Z_]+)(?::([a-zA-Z0-9_-]+))?/);
  if (!marker) throw new Error('Missing synthetic journey marker');
  const [, journey, id] = marker;
  const tail = history.slice(last + 1);
  const outputs = tail.filter(item => item.role === 'tool' || item.type === 'function_call_output');
  const calls = tail.flatMap(item => item.tool_calls?.map(call => call.function.name) ?? (item.type === 'function_call' ? [item.name] : []));
  const tool = (name, args) => ({ journey, tool: { name, arguments: JSON.stringify(args) } });
  const text = value => ({ journey, text: value });
  const parsed = outputs.flatMap(item => {
    const raw = item.output ?? item.content;
    try { return [JSON.parse(typeof raw === 'string' ? raw : raw?.filter?.(part => part.type === 'text').map(part => part.text).join('') ?? '')]; } catch { return []; }
  });
  const objects = value => value && typeof value === 'object' ? [value, ...Object.values(value).flatMap(objects)] : [];
  const all = parsed.flatMap(objects);
  const sourced = () => {
    const source = all.find(value => typeof value.sourceId === 'string' && value.location === 'body') ?? all.find(value => typeof value.sourceId === 'string');
    if (!source) throw new Error('No actually delivered sourceId for fixture answer');
    return text(JSON.stringify({ segments: [{ text: 'Synthetic canonical orchard evidence.', sources: [source.sourceId] }] }));
  };
  if (journey === 'READ') return outputs.length ? sourced() : tool('read_note', { noteId: id });
  if (journey === 'DISCOVER_ALLOW' || journey === 'DISCOVER_DENY') {
    if (!calls.includes('discover_notes')) return tool('discover_notes', { query: 'Pi interactive orchard' });
    if (!calls.includes('request_note_access')) return tool('request_note_access', { noteId: id });
    if (journey === 'DISCOVER_DENY') return text('Synthetic denied request; no note facts delivered.');
    if (!calls.includes('read_note')) return tool('read_note', { noteId: id });
    return sourced();
  }
  if (journey === 'HISTORY') {
    if (!calls.includes('find_notes')) return tool('find_notes', { query: 'orchard', mode: 'literal', note_ids: [id], include_history: true,
      activity_range: { start: '2020-01-01T00:00:00Z', end: '2100-01-01T00:00:00Z', timezone: 'UTC' } });
    if (!calls.includes('read_notes')) {
      const historical = all.find(value => typeof value.evidenceId === 'string' && (value.historical || value.sourceKind === 'retained_note_change'));
      if (!historical) throw new Error('Historical journey has no retained discovery item');
      return tool('read_notes', { evidence_ids: [historical.evidenceId] });
    }
    return sourced();
  }
  if (journey === 'CREATE') return outputs.length ? text('Synthetic proposal staged for human review.') : tool('propose_note', {
    title: 'Pi interactive creation', markdown: 'Synthetic proposal body for editable review.'
  });
  if (journey === 'UPDATE' || journey === 'UPDATE_DIRTY') {
    if (!calls.includes('read_note')) return tool('read_note', { noteId: id });
    if (!calls.includes('propose_note')) return { ...tool('propose_note', { title: 'Pi interactive orchard', markdown: 'The orchard now has eight synthetic pear trees.', noteId: id }), ...(journey === 'UPDATE_DIRTY' ? { delayBefore: 1200 } : {}) };
    // Canonical reads enable structured admission for the rest of this turn.
    // Staging is a workflow acknowledgement, not evidence of a published edit.
    return text(JSON.stringify({ segments: [{ text: 'Synthetic proposal staged for human review.', sources: [] }] }));
  }
  if (journey === 'REFINE') {
    if (!calls.includes('read_note_proposal')) return tool('read_note_proposal', { proposalId: id });
    if (!calls.includes('refine_note_proposal')) {
      const draft = all.find(value => Number.isInteger(value.version) && typeof value.markdown === 'string');
      if (!draft) throw new Error('Refinement has no latest draft version');
      return tool('refine_note_proposal', { proposalId: id, expectedVersion: draft.version, title: draft.title, markdown: `${draft.markdown}\n\nSynthetic refinement of latest edited draft.` });
    }
    return text('Synthetic latest draft refined.');
  }
  if (journey === 'STOP' || journey === 'INTERRUPT') return { journey, text: attempt === 1 ? 'Acknowledged partial fixture text.' : 'Retried fixture complete.', pause: attempt === 1 };
  if (journey === 'FOLLOWUP') {
    if (!JSON.stringify(history.slice(0, last)).includes('Echo phrase. Echo phrase.')) throw new Error('Source-free answer missing from follow-up history');
    return text('Synthetic follow-up remembers Echo phrase.');
  }
  if (journey === 'CONTEXT') {
    const selected = context.find(value => value.selectionRead || value.kind === 'selected_excerpt' && value.read);
    if (!selected) throw new Error('UI send omitted selected canonical passage');
    if (!outputs.length) return tool('read_notes', { cursor: (selected.selectionRead ?? selected.read).cursor });
    return sourced();
  }
  if (journey === 'HELLO' || journey === 'MODEL') return text('Synthetic hello. Echo phrase. Echo phrase.');
  throw new Error(`Unsupported journey ${journey}`);
}

export async function startInteractiveFixture(port = 1443, { followons = process.env.PI_PROTOTYPE_FOLLOWONS_GATE === 'true' } = {}) {
  const requests = [], attempts = new Map();
  const supplementalEvidence = createSupplementalEvidenceControl();
  const server = createServer(async (req, res) => {
    let captured; const startedAt = Date.now();
    try {
      if (followons && await supplementalEvidence.handle(req, res)) return;
      if (req.headers.authorization) throw new Error('Fixture must never receive credentials');
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 262144) throw new Error('Oversize request'); }
      const body = JSON.parse(raw); captured = { path: req.url, body, requestBytes: Buffer.byteLength(raw) };
      const compatible = req.url === '/local/v1/chat/completions';
      if (!compatible && req.url !== '/openai/v1/responses') throw new Error('Unexpected fixture route');
      const history = compatible ? body.messages : body.input;
      const user = JSON.stringify(history?.findLast(item => item.role === 'user') ?? {});
      const key = `${req.url}:${user}`;
      const attempt = (attempts.get(key) ?? 0) + 1; attempts.set(key, attempt);
      const reply = planWorkspaceReply(body, compatible, attempt, followons);
      const inputUsage = reply.usageInput ?? 8, outputUsage = reply.usageOutput ?? 8;
      requests.push({ startedAt, index: requests.length, path: req.url, model: body.model, journey: reply.journey, tool: reply.tool?.name ?? null,
        attempt, requestBytes: Buffer.byteLength(raw), body, completed: false });
      const record = requests.at(-1);
      res.on('close', () => { record.closed = true; record.closedAt = Date.now(); });
      if (reply.delayBefore) { record.delayedReplyAt = Date.now(); await delay(reply.delayBefore); if (res.destroyed) return; record.replyReleasedAt = Date.now(); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = async value => { if (!res.destroyed) { record.firstFrameAt ??= Date.now(); res.write(`data: ${JSON.stringify(value)}\n\n`); await delay(20); } };
      const callId = `interactive_${record.index}`;
      if (compatible) {
        const chunk = delta => ({ id: callId, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] });
        await send(chunk({ role: 'assistant' }));
        if (reply.tool) await send(chunk({ tool_calls: [{ index: 0, id: callId, type: 'function', function: reply.tool }] }));
        else { record.firstTextAt = Date.now(); await send(chunk({ content: reply.text })); }
        if (reply.barrier) { await supplementalEvidence.hold(reply.barrier, record, res); if (res.destroyed) return; }
        if (reply.holdUntilClosed) { await holdInteractiveInterruption(record, res); return; }
        if (reply.pause) { record.pauseStartedAt = Date.now(); await delay(30000); record.pauseFinishedAt = Date.now(); if (res.destroyed) return; }
        await send({ id: callId, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: reply.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: inputUsage, completion_tokens: outputUsage, total_tokens: inputUsage + outputUsage } });
        record.completed = true; record.completedAt = Date.now(); res.end('data: [DONE]\n\n');
      } else {
        const item = reply.tool ? { type: 'function_call', id: callId, call_id: callId, name: reply.tool.name, arguments: '' }
          : { type: 'message', id: callId, role: 'assistant', status: 'in_progress', content: [] };
        await send({ type: 'response.created', response: { id: callId } });
        await send({ type: 'response.output_item.added', output_index: 0, item });
        if (!reply.tool) record.firstTextAt = Date.now();
        await send(reply.tool ? { type: 'response.function_call_arguments.delta', output_index: 0, delta: reply.tool.arguments }
          : { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: reply.text });
        if (reply.barrier) { await supplementalEvidence.hold(reply.barrier, record, res); if (res.destroyed) return; }
        if (reply.holdUntilClosed) { await holdInteractiveInterruption(record, res); return; }
        if (reply.pause) { record.pauseStartedAt = Date.now(); await delay(30000); record.pauseFinishedAt = Date.now(); if (res.destroyed) return; }
        const done = reply.tool ? { ...item, arguments: reply.tool.arguments, status: 'completed' } : { ...item, status: 'completed', content: [{ type: 'output_text', text: reply.text, annotations: [] }] };
        await send({ type: 'response.output_item.done', output_index: 0, item: done });
        await send({ type: 'response.completed', response: { id: callId, status: 'completed', output: [done], usage: { input_tokens: inputUsage, output_tokens: outputUsage, total_tokens: inputUsage + outputUsage } } });
        record.completed = true; record.completedAt = Date.now(); res.end();
      }
    } catch (error) { requests.push({ ...captured, error: String(error) }); if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { requests, supplementalEvidence, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
