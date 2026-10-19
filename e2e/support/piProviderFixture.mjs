import assert from 'node:assert/strict';
import { createServer } from 'node:http';

/** Deterministic Chat Completions transport; results are native integration evidence, never live-model claims. */
export async function startPiProviderFixture({ readQuery = 'Pi acceptance lantern' } = {}) {
  assert(typeof readQuery === 'string' && readQuery.length > 0 && readQuery.length <= 160);
  let fail = false, requests = 0, holdSummaries = false, pendingSummaries = 0;
  let edit, creation;
  const summaryGates = new Set();
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'pi-acceptance-fixture' }], models: [{ key: 'pi-acceptance-fixture', capabilities: { tools: true, reasoning: { allowed_options: ['on', 'off'], default: 'on' } }, loaded_instances: [{ id: 'pi-acceptance-fixture', config: { context_length: 129280 } }] }] })); return;
    }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    requests++;
    let bytes = '';
    for await (const chunk of req) { bytes += chunk; if (bytes.length > 2_000_000) { res.writeHead(413).end(); return; } }
    const input = JSON.parse(bytes);
    if (fail) { res.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'insufficient_quota', message: 'Fixture account quota' } })); return; }
    const userIndex = input.messages.findLastIndex(message => message.role === 'user');
    const prompt = input.messages[userIndex]?.content ?? '';
    const summary = input.messages.some(message => message.role === 'system' && message.content?.includes('context summarization assistant'));
    const tools = input.messages.slice(userIndex + 1).filter(message => message.role === 'tool');
    res.writeHead(200, prompt.includes('fixture-missing-content-type') ? {} : { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish = null) => { if (!res.destroyed) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'pi-acceptance-fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`); };
    const pause = (ms) => new Promise(ok => setTimeout(ok, ms));
    const call = (name, args) => { chunk({ tool_calls: [{ index: 0, id: `fixture-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); chunk({}, 'tool_calls'); };
    await pause(500);
    if (summary && holdSummaries) {
      pendingSummaries++; chunk({ reasoning_content: 'Deterministic held summary.' });
      await new Promise(resolve => { const release = () => { summaryGates.delete(release); resolve(); }; summaryGates.add(release); res.once('close', release); });
      pendingSummaries--;
    }
    if (summary) { chunk({ content: '## Goal\nWelcome a fictional observatory visitor.\n## Constraints & Preferences\n- Use no notes or tools.\n## Progress\n### Done\n- Reviewed generated fictional history.\n### In Progress\n- Continue with a welcome.\n### Blocked\n- (none)\n## Key Decisions\n- Keep the visitor welcome brief.\n## Next Steps\n1. Answer the current prompt.\n## Critical Context\n- Source-free synthetic observatory scenario.' }); chunk({}, 'stop'); }
    else if (prompt.includes('fixture-create') && creation && tools.length === 0) call('create_note', creation);
    else if (prompt.includes('fixture-edit') && edit && tools.length === 0) call('read_note', { noteId: edit.noteId });
    else if (prompt.includes('fixture-edit') && edit && tools.length === 1) {
      const read = JSON.parse(tools[0].content ?? '{}');
      call('edit_note', { noteId: edit.noteId, expectedReadSourceId: read.source?.sourceId ?? 'missing', edits: [{ oldText: edit.oldText, newText: edit.newText }] });
    }
    else if (prompt.includes('fixture-read') && tools.length === 0) call('search_notes', { query: readQuery });
    else if (prompt.includes('fixture-read') && tools.length === 1) {
      const result = JSON.parse(tools[0].content ?? '{}'); call('read_note', { noteId: result.items?.[0]?.noteId ?? 'missing-fixture-note' });
    } else if (prompt.includes('fixture-error') && tools.length === 0) call('read_note', { noteId: 'missing-fixture-note' });
    else {
      chunk({ reasoning_content: 'Fixture reasoning begins. ' }); await pause(500); chunk({ reasoning_content: 'Fixture reasoning ends.' });
      const read = tools.at(-1)?.content ? JSON.parse(tools.at(-1).content) : undefined;
      const editedSource = prompt.includes('fixture-edit-historical') && tools[0]?.content ? JSON.parse(tools[0].content).citation : read?.read?.citation;
      const text = prompt.includes('fixture-create') ? `Fixture creation outcome: ${JSON.stringify({ status: read?.status, receiptId: read?.receiptId, code: read?.code })} ${read?.read?.citation ?? ''}` : prompt.includes('fixture-edit') ? `Fixture edit outcome: ${JSON.stringify({ status: read?.status, receiptId: read?.receiptId, code: read?.code })} ${editedSource ?? ''}` : prompt.includes('fixture-read') && read?.citation ? `The lantern is amber. ${read.citation}` : 'Fixture ordinary answer.';
      chunk({ content: text }); await pause(prompt.includes('fixture-hold') ? 8000 : 500); chunk({ content: ' Finished.' }); chunk({}, 'stop');
    }
    if (!res.destroyed) res.end('data: [DONE]\n\n');
  });
  await new Promise((ok, failStart) => { server.once('error', failStart); server.listen(0, '127.0.0.1', ok); });
  const address = server.address(); assert(address && typeof address !== 'string');
  return { endpoint: `http://127.0.0.1:${address.port}/v1`, model: 'pi-acceptance-fixture', setEdit(value) { edit = value; }, setCreate(value) { creation = value; }, setFailure(value) { fail = value; }, setHoldSummaries(value) { holdSummaries = value; if (!value) for (const release of summaryGates) release(); }, get pendingSummaries() { return pendingSummaries; }, get requests() { return requests; }, interruptConnections() { server.closeAllConnections(); }, async close() { server.closeAllConnections(); await new Promise((ok, error) => server.close(e => e ? error(e) : ok())); } };
}
