import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import { ToolResultEntry, type EntryRecord, type LiveState, type NestedToolSlot, type ToolSlot, type ToolDiagnostic } from '@earendil-works/pi-durable';
import { messageText } from './piConversationView';
import type { CommittedEdit } from '../pi/publication';

export type ToolActivity = { kind: 'tool'; key: string; name: string; arguments?: ToolCall['arguments']; result?: ToolResultMessage; diagnostics?: readonly ToolDiagnostic[]; live?: ToolSlot | NestedToolSlot; pending: boolean; publication?: CommittedEdit };
export type ActivityItem = ToolActivity | { kind: 'reasoning'; key: string; text: string; streaming: boolean };
export type ActivityGroup = { kind: 'activity'; key: string; items: ActivityItem[] };
export type TranscriptItem = ActivityGroup | { kind: 'message'; key: string; message: Message; streaming: boolean; actionMessage: Message | null };

/** Disposable presentation only: pair requests/results without changing Pi's history. */
export function activityTranscript(entries: readonly EntryRecord[], live: LiveState, editOutcomes: Readonly<Record<string, CommittedEdit>> = {}): TranscriptItem[] {
  const transcript: TranscriptItem[] = [];
  const tools = new Map<string, { item: ToolActivity; group: ActivityGroup }>();
  let group: ActivityGroup | undefined;
  let turnKey = String(entries[0]?.id ?? 'live'), ordinal = 0;
  const activity = () => {
    if (!group) { group = { kind: 'activity', key: `${turnKey}:activity:${ordinal++}`, items: [] }; transcript.push(group); }
    return group;
  };
  function message(message: Message, key: string, streaming = false, diagnostics?: readonly ToolDiagnostic[], publication?: CommittedEdit) {
    if (message.role === 'toolResult') {
      const found = tools.get(message.toolCallId);
      if (found) { found.item.result = message; found.item.diagnostics = diagnostics; found.item.publication = publication; }
      else {
        const target = activity();
        const item: ToolActivity = { kind: 'tool', key: message.toolCallId, name: message.toolName, result: message, diagnostics, pending: false, publication };
        target.items.push(item); tools.set(item.key, { item, group: target });
      }
    } else if (message.role === 'assistant') {
      const parts: Extract<TranscriptItem, { kind: 'message' }>[] = [];
      message.content.forEach((block, index) => {
        const blockKey = `${key}:${index}`;
        if (block.type === 'thinking' && block.thinking) activity().items.push({ kind: 'reasoning', key: blockKey, text: block.thinking, streaming });
        else if (block.type === 'toolCall') {
          const target = activity();
          const item: ToolActivity = { kind: 'tool', key: block.id, name: block.name, arguments: block.arguments, pending: streaming };
          target.items.push(item); tools.set(item.key, { item, group: target });
        } else if (block.type === 'text' && block.text) {
          group = undefined;
          const part = { kind: 'message' as const, key: blockKey, message: { ...message, content: [block], errorMessage: undefined }, streaming, actionMessage: null };
          parts.push(part); transcript.push(part);
        }
      });
      if (!streaming && message.errorMessage) {
        group = undefined;
        const part = { kind: 'message' as const, key: `${key}:error`, message: { ...message, content: [] }, streaming, actionMessage: null };
        parts.push(part); transcript.push(part);
      }
      // A response can interleave text with activity. Its final part owns one
      // footer, whose copy action still includes all of that response's text.
      const last = parts.at(-1);
      if (last) last.actionMessage = message;
    } else if (message.role === 'user') {
      group = undefined;
      turnKey = key; ordinal = 0; tools.clear();
      transcript.push({ kind: 'message', key, message, streaming, actionMessage: message });
    }
  }
  for (const entry of entries) {
    if (entry.kind === 'pi.compaction' || entry.kind === 'pi.reset') { group = undefined; continue; }
    entry.model?.forEach((value, index) => message(value, `${entry.id}:${index}`, false, ToolResultEntry.is(entry) ? entry.data?.diagnostics : undefined, entry.byTaskId ? editOutcomes[entry.byTaskId] : undefined));
  }
  for (const slot of [...(live.tools ?? []), ...(live.nestedTools ?? [])]) {
    const found = tools.get(slot.callId);
    if (found) found.item.live = slot;
    else {
      const target = ('parentCallId' in slot ? tools.get(slot.parentCallId)?.group : undefined) ?? activity();
      const item: ToolActivity = { kind: 'tool', key: slot.callId, name: slot.name, live: slot, pending: true, ...('arguments' in slot ? { arguments: slot.arguments } : {}) };
      target.items.push(item); tools.set(item.key, { item, group: target });
    }
  }
  if (live.generation?.message) message(live.generation.message as AssistantMessage, 'streaming', true);
  return transcript;
}

function toolOutcome(tool: ToolActivity): string | undefined {
  if (tool.publication) return tool.name === 'create_note' ? 'Created' : 'Applied';
  const diagnostics = tool.result ? tool.diagnostics : tool.live?.diagnostics;
  // Harness outcomes and native domain codes have separate meanings. In
  // particular, an interrupted publication may have run and remains a failure.
  const harnessOutcomes: Record<string, string> = {
    aborted: 'Stopped', abandoned: 'Not run', blocked: 'Blocked',
    invalid_arguments: 'Needs correction', tool_unavailable: 'Unavailable'
  };
  if (diagnostics?.some(item => item.severity === 'error' && !Object.hasOwn(harnessOutcomes, item.code ?? ''))) return;
  const diagnostic = diagnostics?.find(item => Object.hasOwn(harnessOutcomes, item.code ?? ''));
  if (diagnostic) return harnessOutcomes[diagnostic.code!];
  const details = record(tool.result ? tool.result.details : tool.live?.details);
  const noteEdit = ['edit_note', 'create_note'].includes(tool.name) && ['noteEdit', 'noteCreate'].includes(String(details?.kind)) && ['blocked', 'failed'].includes(String(details?.status));
  const noteRead = ['read_note', 'search_notes'].includes(tool.name) && details?.kind === 'noteToolError';
  if ((!noteEdit && !noteRead) || typeof details?.code !== 'string') return;
  const outcomes: Record<string, string> = {
    changed_base: 'Note changed', stale_read: 'Note changed',
    unavailable_note: 'Note unavailable', excluded_note: 'Note unavailable',
    retired_authority: 'Access ended', stale_authority: 'Access changed',
    invalid_note: 'Needs correction', invalid_query: 'Needs correction',
    invalid_limit: 'Needs correction', invalid_cursor: 'Needs correction',
    invalid_citation_location: 'Needs correction'
  };
  if (noteEdit) Object.assign(outcomes, {
    review_rejected: 'Rejected', rejected: 'Rejected',
    write_off: 'Editing disabled', operation_denied: 'Permission needed', scope_denied: 'Permission needed',
    target_exists: 'Destination occupied', invalid_mutation: 'Needs correction', review_required: 'Needs approval', editor_busy: 'Editor busy',
    unknown_source: 'Needs fresh read', wrong_source: 'Needs fresh read', closed: 'Workspace restarting'
  });
  return Object.hasOwn(outcomes, details.code) ? outcomes[details.code] : undefined;
}
export function toolFailed(tool: ToolActivity): boolean {
  return !toolOutcome(tool) && Boolean(tool.result ? tool.result.isError || tool.diagnostics?.some(item => item.severity === 'error')
    : tool.live && 'summary' in tool.live && tool.live.summary?.isError || tool.live?.diagnostics?.some(item => item.severity === 'error'));
}
export function toolStatus(tool: ToolActivity): string {
  const outcome = toolOutcome(tool);
  if (outcome) return outcome;
  if (toolFailed(tool)) return 'Failed';
  if (tool.result || tool.live && 'summary' in tool.live && tool.live.summary) return 'Complete';
  if (tool.live?.status === 'running') return 'Running';
  if (tool.live?.status === 'pending') return 'Pending';
  if (tool.live?.status === 'done') return 'No result';
  return tool.pending ? 'Pending' : 'No result';
}
export function toolCommitWarning(tool: ToolActivity): string | undefined {
  if (tool.publication?.commitWarning) return tool.publication.commitWarning.message;
  const details = record(tool.result?.details);
  if (!['edit_note', 'create_note'].includes(tool.name) || !['noteEdit', 'noteCreate'].includes(String(details?.kind)) || details?.status !== 'committed') return;
  const message = record(details.commitWarning)?.message;
  return typeof message === 'string' ? message : undefined;
}
export function toolLabel(tool: ToolActivity): string {
  const active = toolStatus(tool) === 'Running' || toolStatus(tool) === 'Pending';
  if (tool.name === 'search_notes') return active ? 'Searching notes' : 'Searched notes';
  if (tool.name === 'read_note') return active ? 'Reading note' : 'Read note';
  return tool.name.replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
export function toolSubject(tool: ToolActivity): string {
  if (tool.name === 'search_notes' && typeof tool.arguments?.query === 'string') return tool.arguments.query;
  const source = record(record(tool.result?.details)?.source);
  if (typeof source?.title === 'string' && source.title) return source.title;
  if (tool.name === 'read_note' && typeof tool.arguments?.noteId === 'string') return tool.arguments.noteId;
  return '';
}
export function activitySummary(items: ActivityItem[]): string {
  const tools = items.filter((item): item is ToolActivity => item.kind === 'tool');
  const active = tools.some(tool => ['Running', 'Pending'].includes(toolStatus(tool)));
  const actions = new Set(tools.map(tool => tool.name === 'search_notes' ? active ? 'Searching notes' : 'Searched notes' : tool.name === 'read_note' ? active ? 'reading notes' : 'read notes' : active ? 'running tools' : 'ran tools'));
  const summary = [...actions].join(', ');
  return summary ? summary[0].toUpperCase() + summary.slice(1) : 'Reasoning';
}
export function formatToolValue(value: unknown): string {
  if (typeof value === 'string') { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
  return JSON.stringify(value, null, 2) ?? '';
}
export function toolOutput(tool: ToolActivity): string {
  return tool.result ? formatToolValue(messageText(tool.result)) : tool.live?.output ?? '';
}
