import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { messageCopyText, messageTime } from './piMessage';
import { activityTranscript } from './piActivity';
import type { EntryRecord } from '@earendil-works/pi-durable';
import PiMessage from './PiMessage.svelte';

it('copies all authored text as Markdown without reasoning, tool calls, or footer metadata', () => {
  const message = fauxAssistantMessage([
    { type: 'thinking', thinking: 'Private reasoning' },
    { type: 'text', text: '**First** paragraph' },
    fauxToolCall('read_note', {}, { id: 'read-1' }),
    { type: 'text', text: '```ts\nconst answer = 42;\n```' }
  ]);
  expect(messageCopyText(message)).toBe('**First** paragraph\n```ts\nconst answer = 42;\n```');
  expect(messageCopyText({ role: 'user', content: 'My **question**\n\nSecond paragraph', timestamp: 1 })).toBe('My **question**\n\nSecond paragraph');
  expect(messageCopyText({ ...message, errorMessage: 'Response interrupted' }).endsWith('\n\nResponse interrupted')).toBe(true);
});

it('uses Pi response timing for completion and keeps missing completion timing honest', () => {
  const message = { ...fauxAssistantMessage('Answer', { timestamp: 1_700_000_000_000 }), durationMs: 12_345 };
  expect(messageTime(message)?.date.getTime()).toBe(1_700_000_012_345);
  expect(messageTime(message)?.label).toBe('Finished');
  expect(messageTime({ role: 'user', content: 'Question', timestamp: message.timestamp })?.label).toBe('Sent');
  expect(messageTime({ ...message, durationMs: undefined })?.label).toBe('Started');
  expect(messageTime({ ...message, timestamp: NaN })).toBeUndefined();
  const body = render(PiMessage, { props: { message } }).body;
  expect(body).toContain('2023-11-14T22:13:32.345Z');
  expect(body).toContain('Copy message');
  expect(render(PiMessage, { props: { message, streaming: true } }).body).not.toContain('pi-message-actions');
});

it('places one copy footer after the last displayed part of a whole Pi response', () => {
  const message = fauxAssistantMessage([
    { type: 'text', text: 'Before the tool.' }, fauxToolCall('read_note', {}, { id: 'read-1' }),
    { type: 'text', text: 'After the tool.' }
  ]);
  const entry: EntryRecord = { id: 1 as EntryRecord['id'], conversationId: 1 as EntryRecord['conversationId'], kind: 'fixture', model: [message] };
  const parts = activityTranscript([entry], {}).filter(item => item.kind === 'message');
  expect(parts).toHaveLength(2);
  expect(parts[0].actionMessage).toBeNull();
  expect(parts[1].actionMessage).toBe(message);
  expect(messageCopyText(parts[1].actionMessage!)).toBe('Before the tool.\nAfter the tool.');
  expect(parts.map(part => render(PiMessage, { props: { message: part.message, actionMessage: part.actionMessage } }).body).join('').match(/data-testid="pi-message-actions"/g)).toHaveLength(1);
});

it('shows an aborted response neutrally while retaining actual provider failures', () => {
  const message = fauxAssistantMessage('Partial answer', { stopReason: 'aborted', errorMessage: 'Request cancelled' });
  const stopped = render(PiMessage, { props: { message } }).body;
  expect(stopped).toContain('Partial answer');
  expect(stopped).toContain('Stopped.');
  expect(stopped).not.toContain('class="pi-error');
  expect(stopped).not.toContain('Request cancelled');
  const failed = render(PiMessage, { props: { message: { ...message, stopReason: 'error', errorMessage: 'Model unavailable' } } }).body;
  expect(failed).toContain('class="pi-error');
  expect(failed).toContain('Model unavailable');
});
