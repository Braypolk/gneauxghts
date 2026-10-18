import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
import type { EntryRecord, LiveState } from '@earendil-works/pi-durable';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { activitySummary, activityTranscript, toolFailed, toolOutput, toolStatus, toolSubject, type ActivityGroup, type ToolActivity } from './piActivity';
import PiActivityGroup from './PiActivityGroup.svelte';

const entries = (...messages: Message[]): EntryRecord[] => messages.map((message, index) => ({ id: index + 1 as EntryRecord['id'], conversationId: 1 as EntryRecord['conversationId'], kind: 'fixture', model: [message] }));
const user = { role: 'user', content: 'Find themes', timestamp: 1 } as const;
const call = (id = 'read-1') => fauxAssistantMessage(fauxToolCall('read_note', { noteId: 'note-1' }, { id }), { stopReason: 'toolUse' });
const result = (id = 'read-1', isError = false): ToolResultMessage => ({ role: 'toolResult', toolCallId: id, toolName: 'read_note', content: [{ type: 'text', text: '{"markdown":"A note"}' }], details: { source: { title: 'Project ideas' } }, isError, timestamp: 2, durationMs: 120 });
const group = (items: ReturnType<typeof activityTranscript>, index = 1) => items[index] as ActivityGroup;
const tool = (group: ActivityGroup) => group.items.find((item): item is ToolActivity => item.kind === 'tool')!;

it('groups consecutive reasoning/tool rounds, pairing each result once and keeping the answer outside', () => {
  const history = entries(user, fauxAssistantMessage([{ type: 'thinking', thinking: 'Look for related notes.' }, fauxToolCall('search_notes', { query: 'projects' }, { id: 'search-1' })], { stopReason: 'toolUse' }),
    { role: 'toolResult', toolName: 'search_notes', toolCallId: 'search-1', content: [{ type: 'text', text: '{"items":[]}' }], isError: false, timestamp: 1 }, call(), result(), fauxAssistantMessage('Here are the themes.'));
  const original = JSON.stringify(history);
  const transcript = activityTranscript(history, {});
  expect(transcript.map(item => item.kind)).toEqual(['message', 'activity', 'message']);
  expect(group(transcript).items.map(item => item.kind)).toEqual(['reasoning', 'tool', 'tool']);
  expect(activitySummary(group(transcript).items)).toBe('Searched notes, read notes');
  const read = group(transcript).items[2] as ToolActivity;
  expect(toolSubject(read)).toBe('Project ideas');
  expect(toolStatus(read)).toBe('Complete');
  expect(toolOutput(read)).toBe('{\n  "markdown": "A note"\n}');
  expect(JSON.stringify(history)).toBe(original);
});

it('keeps activity separate across prose, user turns, and hidden context boundaries', () => {
  const history = entries(user, call(), result(), fauxAssistantMessage('First answer'), call('read-2'), result('read-2'), user, call(), result());
  const transcript = activityTranscript(history, {});
  expect(transcript.map(item => item.kind)).toEqual(['message', 'activity', 'message', 'activity', 'message', 'activity']);
  expect(new Set(transcript.map(item => item.key)).size).toBe(transcript.length);
  const withReset = [history[0], history[1], { ...history[2], kind: 'pi.reset', model: [user] }, history[4]];
  expect(activityTranscript(withReset, {}).map(item => item.kind)).toEqual(['message', 'activity', 'activity']);
});

it('merges live progress into the existing row and keeps group identity through completion', () => {
  const history = entries(user, call());
  const live: LiveState = { tools: [{ callId: 'read-1', name: 'read_note', status: 'running', output: 'Reading…' }] };
  const running = group(activityTranscript(history, live));
  expect(running.items).toHaveLength(1);
  expect(toolStatus(tool(running))).toBe('Running');
  expect(toolOutput(tool(running))).toBe('Reading…');
  expect(activitySummary(running.items)).toBe('Reading notes');
  const settled = group(activityTranscript([...history, ...entries(result()).map(entry => ({ ...entry, id: 3 as EntryRecord['id'] }))], {}));
  expect(settled.key).toBe(running.key);
  expect(settled.items).toHaveLength(1);
  expect(toolStatus(tool(settled))).toBe('Complete');
  expect(toolStatus(tool(group(activityTranscript(history, {}))))).toBe('No result');
  expect(toolStatus(tool(group(activityTranscript(history, { tools: [{ ...live.tools![0], status: 'done' }] }))))).toBe('No result');
});

it('keeps orphaned results from paginated history readable and surfaces failures while collapsed', () => {
  const transcript = activityTranscript(entries(result('missing-request', true)), {});
  const activity = group(transcript, 0);
  expect(toolSubject(tool(activity))).toBe('Project ideas');
  const body = render(PiActivityGroup, { props: { group: activity } }).body;
  expect(body).toContain('1 failed');
  expect(body).toContain('Failed');
  expect(body).toContain('read_note');
  expect(body).toContain('data-testid="pi-tool-activity-scroll"');
  expect(body.match(/<div[^>]*data-testid="pi-tool-activity"[^>]*>/)?.[0]).toContain('data-state="closed"');
});

it('shows retained and live review rejections neutrally while preserving real failures', () => {
  const details = { kind: 'noteEdit', status: 'blocked', code: 'review_rejected', message: 'The user discarded this edit.' };
  const rejected: ToolActivity = { kind: 'tool', key: 'edit', name: 'edit_note', pending: false,
    result: { role: 'toolResult', toolCallId: 'edit', toolName: 'edit_note', content: [{ type: 'text', text: JSON.stringify(details) }], details, isError: true, timestamp: 2 } };
  expect(toolStatus(rejected)).toBe('Rejected');
  expect(toolFailed(rejected)).toBe(false);
  const body = render(PiActivityGroup, { props: { group: { kind: 'activity', key: 'edit', items: [rejected] } } }).body;
  expect(body).toContain('Rejected');
  expect(body).not.toContain('failed');
  expect(body).not.toContain('data-status="error"');
  expect(toolStatus({ ...rejected, result: undefined, live: { callId: 'edit', name: 'edit_note', status: 'done', details } })).toBe('Rejected');

  const changed = { ...rejected, result: { ...rejected.result!, details: { ...details, code: 'changed_base' } } };
  expect(toolStatus(changed)).toBe('Note changed');
  expect(toolFailed(changed)).toBe(false);
  const changedBody = render(PiActivityGroup, { props: { group: { kind: 'activity', key: 'changed', items: [changed] } } }).body;
  expect(changedBody).toContain('Note changed');
  expect(changedBody).not.toContain('failed');
  expect(changedBody).not.toContain('data-status="error"');
  const failed = { ...rejected, result: { ...rejected.result!, details: { ...details, code: 'storage' } } };
  expect(toolStatus(failed)).toBe('Failed');
  expect(toolFailed(failed)).toBe(true);
  // An unrelated failure's wording or stale progress cannot override its outcome.
  expect(toolStatus({ ...failed, live: { callId: 'edit', name: 'edit_note', status: 'done', details } })).toBe('Failed');
  expect(toolStatus({ ...rejected, name: 'other_tool' })).toBe('Failed');
});

it.each([
  ['edit_note', 'noteEdit', 'write_off', 'Editing disabled'],
  ['edit_note', 'noteEdit', 'operation_denied', 'Permission needed'],
  ['edit_note', 'noteEdit', 'scope_denied', 'Permission needed'],
  ['edit_note', 'noteEdit', 'review_required', 'Needs approval'],
  ['edit_note', 'noteEdit', 'rejected', 'Rejected'],
  ['edit_note', 'noteEdit', 'editor_busy', 'Editor busy'],
  ['edit_note', 'noteEdit', 'unknown_source', 'Needs fresh read'],
  ['edit_note', 'noteEdit', 'wrong_source', 'Needs fresh read'],
  ['edit_note', 'noteEdit', 'closed', 'Workspace restarting'],
  ['read_note', 'noteToolError', 'unavailable_note', 'Note unavailable'],
  ['read_note', 'noteToolError', 'stale_read', 'Note changed'],
  ['search_notes', 'noteToolError', 'retired_authority', 'Access ended'],
  ['read_note', 'noteToolError', 'stale_authority', 'Access changed'],
  ['read_note', 'noteToolError', 'invalid_note', 'Needs correction'],
  ['read_note', 'noteToolError', 'invalid_citation_location', 'Needs correction'],
  ['search_notes', 'noteToolError', 'invalid_query', 'Needs correction'],
  ['search_notes', 'noteToolError', 'invalid_limit', 'Needs correction'],
  ['search_notes', 'noteToolError', 'invalid_cursor', 'Needs correction']
])('labels expected %s outcome %s/%s neutrally in history and live progress', (name, kind, code, status) => {
  const details = { kind, status: 'blocked', code };
  const item: ToolActivity = { kind: 'tool', key: 'test', name, pending: false,
    result: { ...result(), details, isError: true } };
  expect(toolStatus(item)).toBe(status);
  expect(toolFailed(item)).toBe(false);
  const live: ToolActivity = { ...item, result: undefined, live: { callId: 'test', name, status: 'done', details, summary: { isError: true } } };
  expect(toolStatus(live)).toBe(status);
  expect(toolFailed(live)).toBe(false);
  const body = render(PiActivityGroup, { props: { group: { kind: 'activity', key: 'test', items: [item] } } }).body;
  expect(body).toContain(status);
  expect(body).not.toContain('failed');
  expect(body).not.toContain('data-status="error"');
});

it.each(['storage', 'unavailable', 'uncertain_publication', 'interrupted', 'editor_conflict', 'editorConflict', 'unknown_code', 'toString'])(
  'keeps genuine or unrecognized edit errors visible: %s', code => {
    const item: ToolActivity = { kind: 'tool', key: 'test', name: 'edit_note', pending: false,
      result: { ...result(), details: { kind: 'noteEdit', status: 'blocked', code }, isError: true } };
    expect(toolStatus(item)).toBe('Failed');
    expect(toolFailed(item)).toBe(true);
  }
);

it('uses the final result instead of stale live errors and counts only actual failures in mixed groups', () => {
  const complete: ToolActivity = { kind: 'tool', key: 'read', name: 'read_note', pending: false, result: result(),
    live: { callId: 'read', name: 'read_note', status: 'done', summary: { isError: true }, diagnostics: [{ severity: 'error', code: 'tool_error', message: 'Old progress' }] } };
  expect(toolStatus(complete)).toBe('Complete');
  expect(toolFailed(complete)).toBe(false);
  const rejected: ToolActivity = { ...complete, key: 'edit', name: 'edit_note', result: { ...complete.result!, isError: true,
    details: { kind: 'noteEdit', status: 'blocked', code: 'review_rejected' } } };
  const failed: ToolActivity = { ...complete, key: 'failure', result: { ...complete.result!, isError: true } };
  const body = render(PiActivityGroup, { props: { group: { kind: 'activity', key: 'mixed', items: [complete, rejected, failed] } } }).body;
  expect(body).toContain('1 failed');
  expect(body).not.toContain('2 failed');
});

it('places live nested calls in their parent group and preserves streaming text after activity', () => {
  const transcript = activityTranscript(entries(user, call()), {
    tools: [{ callId: 'read-1', name: 'read_note', status: 'running' }],
    nestedTools: [{ callId: 'read-1/nested', parentCallId: 'read-1', name: 'lookup', arguments: {}, status: 'done', summary: { isError: true }, taskId: 2, parentTaskId: 1 }],
    generation: { attempt: 1, message: fauxAssistantMessage('Partial answer') }
  } as LiveState);
  expect(group(transcript).items).toHaveLength(2);
  expect(toolStatus(group(transcript).items[1] as ToolActivity)).toBe('Failed');
  expect(transcript[2]).toMatchObject({ kind: 'message', streaming: true });
});

it('reads cancellation from retained tool diagnostics without treating restarts or errors as user stops', () => {
  const retained = (code: string) => entries(result('edit', true)).map(entry => ({ ...entry, kind: 'pi.tool-result',
    data: { diagnostics: [{ severity: 'error', code, message: 'Tool ended' }] } } as EntryRecord));
  const stopped = tool(group(activityTranscript(retained('aborted'), {}), 0));
  expect(toolStatus(stopped)).toBe('Stopped');
  expect(toolFailed(stopped)).toBe(false);
  expect(toolStatus(tool(group(activityTranscript(retained('interrupted'), {}), 0)))).toBe('Failed');
  expect(toolStatus(tool(group(activityTranscript(retained('tool_error'), {}), 0)))).toBe('Failed');
  for (const [code, status] of [['abandoned', 'Not run'], ['blocked', 'Blocked'], ['invalid_arguments', 'Needs correction'], ['tool_unavailable', 'Unavailable']]) {
    const item = tool(group(activityTranscript(retained(code), {}), 0));
    expect(toolStatus(item)).toBe(status);
    expect(toolFailed(item)).toBe(false);
  }
  expect(toolStatus({ ...stopped, diagnostics: [...stopped.diagnostics!, { severity: 'error', code: 'tool_error', message: 'Actual error' }] })).toBe('Failed');
});

it('marks only the latest reasoning block as thinking', () => {
  const transcript = activityTranscript(entries(user), { generation: { attempt: 1, message: fauxAssistantMessage([
    { type: 'thinking', thinking: 'First thought.' }, { type: 'thinking', thinking: 'Current thought.' }
  ]) } } as LiveState);
  const body = render(PiActivityGroup, { props: { group: group(transcript), generationStatus: 'Thinking' } }).body;
  expect(body.match(/Thinking…/g)).toHaveLength(1);
  expect(body).toContain('Reasoning');
  expect(body).not.toContain('spinner');
});
