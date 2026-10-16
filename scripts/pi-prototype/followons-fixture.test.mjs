import test from 'node:test';
import assert from 'node:assert/strict';
import { planFollowonsReply, verifyFollowonsReceipts } from './followons-fixture.mjs';

const workerSystem = 'You are an isolated vault evidence researcher.';
const summarySystem = 'Compact the supplied transcript into a continuation summary.';
const body = (compatible, history, tools = []) => ({ model: 'pi-native-fixture', stream: true, [compatible ? 'messages' : 'input']: history, tools });
const user = content => ({ role: 'user', content });
const result = (compatible, value) => compatible ? { role: 'tool', tool_call_id: 'native_read', content: JSON.stringify(value) } : { type: 'function_call_output', call_id: 'native_read', output: JSON.stringify(value) };
const delivered = (noteId, evidenceId) => ({ items: [{ noteId, evidenceId, sourceId: 'S1', location: 'body', text: 'Actually native-delivered text' }] });

test('planner does not take ownership of base fixture or unmarked summary requests', () => {
  assert.equal(planFollowonsReply(body(true, [user('PI_UI:HELLO')]), true), undefined);
  assert.equal(planFollowonsReply(body(false, [{ role: 'system', content: summarySystem }, user('unmarked transcript')]), false), undefined);
});

for (const compatible of [true, false]) {
  const protocol = compatible ? 'compatible' : 'Responses';
  test(`${protocol} research requests exact scope, reads before selection and retains progress after real compaction`, () => {
    const request = user('PI_FOLLOWONS:RESEARCH:run:note_a,note_b');
    const parent = planFollowonsReply(body(compatible, [request]), compatible);
    assert.deepEqual(JSON.parse(parent.tool.arguments), { question: 'PI_FOLLOWONS:WORKER:run:note_a,note_b', note_ids: ['note_a', 'note_b'], timeout_ms: 120000 });
    const worker = user(JSON.stringify({ question: 'PI_FOLLOWONS:WORKER:run:note_a,note_b', scope: { noteIds: ['note_a', 'note_b'] } }));
    const history = [{ role: 'system', content: workerSystem }, worker];
    assert.deepEqual(JSON.parse(planFollowonsReply(body(compatible, history), compatible).tool.arguments), { note_id: 'note_a' });
    history.push(result(compatible, delivered('note_a', 'e_a')));
    assert.deepEqual(JSON.parse(planFollowonsReply(body(compatible, history), compatible).tool.arguments), { note_id: 'note_b' });
    const summaryInput = body(compatible, [{ role: 'system', content: summarySystem }, user(`<transcript>\n[Tool result]: ${JSON.stringify(delivered('note_a', 'e_a'))}\n</transcript>\nOriginal request (retain its requirements):\n${worker.content}`)]);
    const summary = planFollowonsReply(summaryInput, compatible);
    assert.equal(summary.journey, 'FOLLOWONS_SUMMARY_WORKER');
    const summarizedHistory = [history[0], worker, user(`Continuation summary\n${JSON.stringify({ originalRequest: worker.content, summary: JSON.parse(summary.text).summary })}`)];
    assert.deepEqual(JSON.parse(planFollowonsReply(body(compatible, summarizedHistory), compatible).tool.arguments), { note_id: 'note_b' });
    summarizedHistory.push(result(compatible, delivered('note_b', 'e_b')));
    assert.deepEqual(JSON.parse(planFollowonsReply(body(compatible, summarizedHistory), compatible).text), { evidence_ids: ['e_a', 'e_b'], gaps: [] });
  });
  test(`${protocol} parent summary ownership follows original request even when transcript includes worker`, () => {
    const request = body(compatible, [{ role: 'system', content: summarySystem }, user('<transcript>PI_FOLLOWONS:WORKER:run:note_a</transcript>\nOriginal request (retain its requirements):\nPI_FOLLOWONS:RESEARCH:run:note_a')]);
    const reply = planFollowonsReply(request, compatible);
    assert.equal(reply.journey, 'FOLLOWONS_SUMMARY_PARENT');
    assert.equal(reply.usageInput, Buffer.byteLength(JSON.stringify(request)));
    assert.deepEqual(Object.keys(JSON.parse(reply.text)), ['summary']);
    assert.throws(() => planFollowonsReply({ ...request, tools: [{ type: 'function' }] }, compatible), /Summary inference received tools/);
  });
  test(`${protocol} parent answer selects native-issued selectors, and attachment Retry has explicit initial failure`, () => {
    const first = user('PI_FOLLOWONS:RESEARCH:run:note_a');
    assert.throws(() => planFollowonsReply(body(compatible, [first, result(compatible, { items: [] })]), compatible), /No native-delivered source/);
    const reply = planFollowonsReply(body(compatible, [first, result(compatible, delivered('note_a', 'e_a'))]), compatible);
    assert.deepEqual(JSON.parse(reply.text).segments[0].sources, ['S1']);
    const retry = body(compatible, [user('PI_FOLLOWONS:ATTACH_RETRY:run')]);
    assert.equal(planFollowonsReply(retry, compatible, 1).text, '');
    assert.equal(planFollowonsReply(retry, compatible, 2).text, 'Synthetic attachment delivery completed.');
  });
}

test('hosted web policy asserts initial force, released continuation, and worker isolation', () => {
  const history = [user('PI_FOLLOWONS:WEB:run:note_a')];
  const initial = { ...body(false, history, [{ type: 'web_search' }]), tool_choice: { type: 'web_search' } };
  assert.equal(planFollowonsReply(initial, false).tool.name, 'read_note');
  assert.throws(() => planFollowonsReply({ ...initial, tool_choice: undefined }, false), /not forced/);
  const next = { ...initial, input: [...history, result(false, delivered('note_a', 'e_a'))] };
  assert.throws(() => planFollowonsReply(next, false), /retained on continuation/);
  assert.match(planFollowonsReply({ ...next, tool_choice: undefined }, false).text, /https:\/\/example.com\/pi-followons/);
  assert.throws(() => planFollowonsReply(body(false, [user('PI_FOLLOWONS:WORKER:run:note_a')], [{ type: 'web_search' }]), false), /inherited hosted web/);
});

test('driver cannot accept UI success without actual native protocol receipts', () => {
  assert.throws(() => verifyFollowonsReceipts([], { gate: 'expanded-native-followons-fixture', status: 'passed' }), /Missing local RESEARCH/);
  assert.throws(() => verifyFollowonsReceipts([], { gate: 'expanded-native-followons-fixture', status: 'failed' }), /did not pass/);
});

test('driver validates protocol parity, media wire bytes, exact Retry and hosted continuation receipts', () => {
  const requests = [];
  const add = (compatible, journey, input, extra = {}) => {
    const record = { path: compatible ? '/local/v1/chat/completions' : '/openai/v1/responses', completed: true, journey: `FOLLOWONS_${journey}`, body: { ...body(compatible, [user(input)]), ...extra } };
    requests.push(record); return record;
  };
  for (const compatible of [true, false]) {
    for (const journey of ['RESEARCH', 'WORKER', 'SUMMARY_PARENT', 'SUMMARY_WORKER', 'FRESH']) add(compatible, journey, 'run');
    add(compatible, 'ATTACH', [{ type: compatible ? 'text' : 'input_text', text: 'run pi-followons-attachment synthetic-attachment-bytes' }]);
    add(compatible, 'ATTACH_RETRY', 'run exact original'); add(compatible, 'ATTACH_RETRY', 'run exact original');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1lEAAAAASUVORK5CYII=';
    const image = compatible ? { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } } : { type: 'input_image', image_url: `data:image/png;base64,${png}` };
    add(compatible, 'ATTACH_IMAGE', [{ type: compatible ? 'text' : 'input_text', text: 'run' }, image]);
    if (compatible) {
      add(true, 'ATTACH_AUDIO', [{ type: 'text', text: 'run' }, { type: 'input_audio', input_audio: { data: Buffer.from('RIFFsynthetic-audio-bytes').toString('base64'), format: 'wav' } }]);
      add(true, 'ATTACH_VIDEO', [{ type: 'text', text: 'run' }, { type: 'video_url', video_url: { url: `data:video/mp4;base64,${Buffer.from('synthetic-video-bytes').toString('base64')}` } }]);
    } else add(false, 'ATTACH_PDF', [{ type: 'input_text', text: 'run' }, { type: 'input_file', file_data: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic-pdf-bytes').toString('base64')}` }]);
  }
  add(false, 'WEB', 'run', { tool_choice: { type: 'web_search' } }); add(false, 'WEB', 'run');
  const report = { gate: 'expanded-native-followons-fixture', status: 'passed', run: 'run' };
  assert.equal(verifyFollowonsReceipts(requests, report).length, 3);
  const changed = structuredClone(requests);
  changed.find(record => record.journey === 'FOLLOWONS_ATTACH_AUDIO').body.messages[0].content[1].input_audio.data = 'wrong';
  assert.throws(() => verifyFollowonsReceipts(changed, report), /Changed local native input_audio bytes/);
  const retry = structuredClone(requests);
  retry.findLast(record => record.path.startsWith('/local') && record.journey === 'FOLLOWONS_ATTACH_RETRY').body.messages[0].content = 'changed run';
  assert.throws(() => verifyFollowonsReceipts(retry, report), /Retry wire bytes changed/);
  assert.throws(() => verifyFollowonsReceipts(requests, { ...report, run: 'stale_other_run' }), /Missing local RESEARCH/);
});
