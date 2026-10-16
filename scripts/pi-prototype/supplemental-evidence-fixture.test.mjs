import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSupplementalEvidenceControl, planSupplementalEvidenceReply, SUPPLEMENTAL_EVIDENCE_CONTROL_PATH, verifySupplementalEvidenceReceipts } from './supplemental-evidence-fixture.mjs';

function body(compatible, marker, outputs = [], tools) {
  const history = [{ role: 'user', content: marker }, ...outputs.flatMap((output, index) => compatible
    ? [{ role: 'assistant', tool_calls: [{ function: { name: index ? 'read_notes' : 'read_note' } }] }, { role: 'tool', content: JSON.stringify(output) }]
    : [{ type: 'function_call', name: index ? 'read_notes' : 'read_note' }, { type: 'function_call_output', output: JSON.stringify(output) }])];
  return { model: 'pi-native-fixture', ...(compatible ? { messages: history } : { input: history }), tools: tools ?? (compatible ? [{ type: 'function', function: { name: 'read_notes' } }] : [{ type: 'function', name: 'read_notes' }]) };
}
const delivered = { items: [{ noteId: 'n1', evidenceId: 'e1', sourceId: 'S1', location: 'body' }] };
for (const compatible of [true, false]) {
  const protocol = compatible ? 'compatible' : 'Responses';
  test(`${protocol}: opt-in markers do not hijack unrelated or prior user turns`, () => {
    assert.equal(planSupplementalEvidenceReply(body(compatible, 'PI_UI:HELLO'), compatible), undefined);
    const request = body(compatible, 'PI_SUPPLEMENTAL:EDIT:run:n1');
    (compatible ? request.messages : request.input).push({ role: 'user', content: 'Ordinary request' });
    assert.equal(planSupplementalEvidenceReply(request, compatible), undefined);
  });
  for (const action of ['EDIT', 'RENAME', 'EXCLUDE']) test(`${protocol}: ${action} holds a structured answer only after its exact native read`, () => {
    const marker = `PI_SUPPLEMENTAL:${action}:run:n1`;
    const first = planSupplementalEvidenceReply(body(compatible, marker), compatible);
    assert.equal(first.tool.name, 'read_note'); assert.deepEqual(JSON.parse(first.tool.arguments), { noteId: 'n1' }); assert.equal(first.barrier, undefined);
    for (const invalid of [{ items: [{ noteId: 'n1', evidenceId: 'unread' }] }, { items: [{ noteId: 'another', evidenceId: 'e1', sourceId: 'S1' }] }])
      assert.throws(() => planSupplementalEvidenceReply(body(compatible, marker, [invalid]), compatible), /actually delivered source/);
    const final = planSupplementalEvidenceReply(body(compatible, marker, [delivered]), compatible);
    assert.equal(final.barrier, `run:${action}`); assert.deepEqual(JSON.parse(final.text).segments[0].sources, ['S1']);
  });
  test(`${protocol}: active worker isolation/read selection and fresh admission use separate explicit questions`, () => {
    const parent = planSupplementalEvidenceReply(body(compatible, 'PI_SUPPLEMENTAL:STOP_RESEARCH:run:n1'), compatible);
    assert.equal(parent.tool.name, 'research_notes'); assert.deepEqual(JSON.parse(parent.tool.arguments), { question: 'PI_SUPPLEMENTAL:STOP_WORKER:run:n1', note_ids: ['n1'], timeout_ms: 120000 });
    for (const action of ['STOP_WORKER', 'NEW_WORKER']) {
      const marker = `PI_SUPPLEMENTAL:${action}:run:n1`;
      assert.deepEqual(JSON.parse(planSupplementalEvidenceReply(body(compatible, marker), compatible).tool.arguments), { note_id: 'n1' });
      const selected = planSupplementalEvidenceReply(body(compatible, marker, [delivered]), compatible);
      assert.deepEqual(JSON.parse(selected.text), { evidence_ids: ['e1'], gaps: [] });
      assert.equal(selected.barrier, action === 'STOP_WORKER' ? 'run:STOP_WORKER' : undefined);
      assert.throws(() => planSupplementalEvidenceReply(body(compatible, marker, [{ items: [{ noteId: 'n1', evidenceId: 'unread' }] }]), compatible), /unread/);
      assert.throws(() => planSupplementalEvidenceReply(body(compatible, marker, [], [{ type: 'web_search' }]), compatible), /capabilities/);
    }
    assert.throws(() => planSupplementalEvidenceReply(body(compatible, 'PI_SUPPLEMENTAL:STOP_RESEARCH:run:n1', [{ status: 'partial', items: [] }]), compatible), /actually delivered research/);
  });
}

function response() {
  return Object.assign(new EventEmitter(), { destroyed: false, status: undefined, headers: undefined, output: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; }, end(value = '') { this.output += value; } });
}
function request(method, value, url = SUPPLEMENTAL_EVIDENCE_CONTROL_PATH, headers = {}) {
  return { method, url, headers, async *[Symbol.asyncIterator]() { if (value !== undefined) yield JSON.stringify(value); } };
}
test('control route is exact, CORS-enabled, bounded and credential-free', async () => {
  const control = createSupplementalEvidenceControl();
  assert.equal(await control.handle(request('GET', undefined, '/ordinary-provider-route'), response()), false);
  for (const method of ['OPTIONS', 'GET']) {
    const res = response(); assert.equal(await control.handle(request(method), res), true);
    assert.equal(res.status, method === 'OPTIONS' ? 204 : 200); assert.equal(res.headers['access-control-allow-origin'], '*');
  }
  for (const req of [request('GET', undefined, undefined, { authorization: 'redacted' }), request('GET', undefined, undefined, { cookie: 'redacted' }), request('DELETE'), request('POST', { action: 'release', barrier: 'not-held' }), request('POST', { action: 'release', barrier: 'not-held', extra: true }), request('POST', 'x'.repeat(2049))]) {
    const res = response(); await control.handle(req, res); assert.equal(res.status, 400);
  }
});
test('after-text hold cannot be released before actual inference and resolves on exact release', async () => {
  const control = createSupplementalEvidenceControl();
  await assert.rejects(control.hold('run:EDIT', {}, response()), /actual streamed text/);
  const record = { firstTextAt: Date.now(), completed: false }; const res = response();
  let finished = false; const held = control.hold('run:EDIT', record, res).then(() => { finished = true; });
  await Promise.resolve(); assert.equal(finished, false); assert.equal(control.snapshot()[0].releasedAt, null);
  await assert.rejects(control.hold('run:EDIT', record, res), /Duplicate/);
  const release = response(); await control.handle(request('POST', { action: 'release', barrier: 'run:EDIT' }), release); await held;
  assert.equal(release.status, 200); assert.equal(finished, true); assert.ok(record.supplementalReleasedAt >= record.supplementalHeldAt);
  const duplicate = response(); await control.handle(request('POST', { action: 'release', barrier: 'run:EDIT' }), duplicate); assert.equal(duplicate.status, 400);
});
test('actual native socket cancellation ends worker hold before release, which cannot mark completion', async () => {
  const control = createSupplementalEvidenceControl(); const res = response(); const record = { firstTextAt: Date.now(), completed: false };
  const held = control.hold('run:STOP_WORKER', record, res); res.destroyed = true; res.emit('close'); await held;
  assert.equal(control.snapshot()[0].closedBeforeRelease, true); assert.equal(record.supplementalClosedBeforeRelease, true);
  await control.handle(request('POST', { action: 'release', barrier: 'run:STOP_WORKER' }), response());
  assert.equal(control.snapshot()[0].completed, false);
});

function completeReceipts() {
  const report = { gate: 'supplemental-native-evidence-fixture', status: 'passed', run: 'run', receipts: {} };
  const requests = [];
  for (const protocol of ['local', 'openai']) {
    const compatible = protocol === 'local'; const ownedRun = `run_${protocol}`;
    const cases = report.receipts[protocol] = {};
    const add = (action, count) => { for (let index = 0; index < count; index++) requests.push({ path: compatible ? '/local/v1/chat/completions' : '/openai/v1/responses', journey: `SUPPLEMENTAL_${action}`, body: body(compatible, `PI_SUPPLEMENTAL:${action}:${ownedRun}:${action.startsWith('NEW_') ? 'fresh' : 'stopped'}`), completed: true, startedAt: 30 }); };
    for (const [action, count] of Object.entries({ WARMUP: 1, EDIT: 2, RENAME: 2, EXCLUDE: 2, STOP_RESEARCH: 1, STOP_WORKER: 2, NEW_RESEARCH: 2, NEW_WORKER: 2 })) add(action, count);
    for (const action of ['EDIT', 'RENAME', 'EXCLUDE']) {
      const final = requests.findLast(item => item.journey === `SUPPLEMENTAL_${action}`);
      Object.assign(final, { firstTextAt: 1, supplementalHeldAt: 2, supplementalReleasedAt: 4, supplementalBarrier: `${ownedRun}:${action}` });
      cases[action.toLowerCase()] = { noProvisional: true, mutatedAt: 3 };
    }
    const stopped = requests.findLast(item => item.journey === 'SUPPLEMENTAL_STOP_WORKER');
    Object.assign(stopped, { completed: false, closed: true, closedAt: 20, supplementalHeldAt: 10, supplementalReleasedAt: 25, supplementalBarrier: `${ownedRun}:STOP_WORKER`, supplementalClosedBeforeRelease: true });
    requests.filter(item => item.path === stopped.path && item.journey === 'SUPPLEMENTAL_STOP_WORKER')[0].tool = 'read_notes';
    cases.stop = { noLateEvidence: true, newResearchCompleted: true, stopClickedAt: 15, stoppedNoteId: 'stopped' };
  }
  return { requests, report };
}
test('driver proves exactly 28 requests with source-race ordering and cancelled native worker transport', () => {
  const { requests, report } = completeReceipts(); assert.equal(verifySupplementalEvidenceReceipts(requests, report).length, 2);
  const extra = structuredClone(requests); extra.push({ ...extra.find(item => item.journey === 'SUPPLEMENTAL_STOP_RESEARCH') });
  assert.throws(() => verifySupplementalEvidenceReceipts(extra, report), /request count/);
  for (const mutate of [items => { items.find(item => item.supplementalBarrier?.endsWith(':EDIT')).supplementalReleasedAt = 1; }, items => { items.find(item => item.supplementalBarrier?.endsWith(':STOP_WORKER')).completed = true; }, items => { items.find(item => item.journey === 'SUPPLEMENTAL_NEW_WORKER').body = body(true, 'PI_SUPPLEMENTAL:NEW_WORKER:run_local:stopped'); },
    items => { items.find(item => item.journey === 'SUPPLEMENTAL_WARMUP').path = '/wrong/provider'; },
    items => { const failed = items.find(item => item.journey === 'SUPPLEMENTAL_WARMUP'); delete failed.journey; failed.error = 'Rejected before planner returned'; }]) {
    const changed = structuredClone(requests); mutate(changed); assert.throws(() => verifySupplementalEvidenceReceipts(changed, report));
  }
  assert.throws(() => verifySupplementalEvidenceReceipts(requests, { ...report, status: 'failed' }), /did not pass/);
});
