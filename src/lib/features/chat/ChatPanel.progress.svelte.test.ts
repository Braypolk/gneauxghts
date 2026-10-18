import { render } from 'svelte/server';
import { expect, it, vi } from 'vitest';
import { createRegistry, defineExtension, defineTool, type LiveState } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { PI_CONTEXT } from './pi/runtime';
import { piViewFixture } from './ui/piViewTestSupport';
import { viewLive } from './ui/piConversationView';
import { generationProgress, fallbackProgress } from './ui/piProgress';
import ChatPanel from './ChatPanel.svelte';

it('keeps thinking visible after tools complete and renders answer text before the run settles', async () => {
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture', tools: [defineTool({ name: 'read_note', description: 'Read a fixture note', parameters: Type.Object({}), async execute() { return { output: [{ type: 'text', text: 'A note about projects.' }] }; } })] }));
  const fixture = await piViewFixture({ registry, tokensPerSecond: 300 });
  const answer = 'The recurring theme is creative projects. '.repeat(15);
  try {
    await fixture.binding.initialize();
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('read_note', {}, { id: 'read-1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage([{ type: 'thinking', thinking: 'Consider the themes in this note. '.repeat(25) }, { type: 'text', text: answer }])
    ]);
    const submission = (await fixture.binding.send('Find the themes'))!;
    const live = () => viewLive(fixture.binding.getSnapshot().view);
    const panel = () => render(ChatPanel, { props: { binding: fixture.binding, autoInitialize: false } }).body;
    await vi.waitFor(() => expect(generationProgress(live())).toBe('Thinking'));
    expect(fixture.binding.getSnapshot().entries.some(entry => entry.model?.some(message => message.role === 'toolResult'))).toBe(true);
    const thinking = panel();
    expect(thinking).not.toContain('Complete');
    expect(thinking).toContain('data-testid="pi-tool-generation-status"');
    expect(thinking).toContain('Thinking…');
    expect(thinking).not.toContain('data-testid="pi-activity"');
    expect(thinking).not.toContain('spinner');
    expect(thinking).not.toContain('Generating response');
    expect(thinking.match(/<div[^>]*data-testid="pi-tool-activity"[^>]*>/)?.[0]).toContain('data-state="closed"');
    await vi.waitFor(() => {
      const text = live().generation?.message?.content.find(block => block.type === 'text');
      expect(text?.type === 'text' && text.text.length > 20 && text.text.length < answer.length).toBe(true);
    }, { timeout: 6000 });
    expect((await submission.status(PI_CONTEXT)).status).not.toBe('done');
    expect(generationProgress(live())).toBe('Writing response');
    const writing = panel();
    expect(writing).toContain('data-streaming="true"');
    expect(writing).toContain('The recurring theme');
    expect(writing).not.toContain('Writing response…');
    expect(writing).not.toContain('data-testid="pi-activity"');
    expect(writing).not.toContain('data-testid="pi-tool-generation-status"');
    await submission.wait(PI_CONTEXT);
    await vi.waitFor(() => expect(live().run).toBeUndefined());
    expect(panel()).not.toContain('data-testid="pi-activity"');
  } finally { await fixture.close(); }
}, 15000);

it('distinguishes waiting, retrying, deferred requests, tool preparation, stopping and compaction', () => {
  expect(generationProgress({ generation: { attempt: 1 } })).toBe('Waiting for model');
  expect(generationProgress({ generation: { attempt: 1, retry: { at: 100, error: '' } } })).toBe('Waiting to retry model request');
  expect(generationProgress({ generation: { attempt: 1, deferred: { pollAt: 100 } } })).toBe('Waiting for model response');
  const generation = { attempt: 1, message: fauxAssistantMessage(fauxToolCall('read_note', {}, { id: 'read-1' })) } as NonNullable<LiveState['generation']>;
  expect(generationProgress({ generation })).toBe('Preparing tool calls');
  const run = { taskId: 1 as NonNullable<LiveState['run']>['taskId'], inputs: [] };
  expect(fallbackProgress({ run, generation }, true)).toBe('Stopping');
  expect(fallbackProgress({ run, generation, tools: [{ name: 'read_note', callId: 'read-1', status: 'running' }] }, false)).toBeUndefined();
  expect(fallbackProgress({ run, generation }, false)).toBeUndefined();
  expect(fallbackProgress({ run, generation: { attempt: 1 } }, false)).toBe('Waiting for model');
  expect(fallbackProgress({ run, generation: { attempt: 1, retry: { at: 100, error: '' } } }, false)).toBe('Waiting to retry model request');
  expect(fallbackProgress({ run, generation: { attempt: 1, deferred: { pollAt: 100 } } }, false)).toBe('Waiting for model response');
  expect(fallbackProgress({ compactions: [{ taskId: 1, reason: 'threshold', attempt: 1, blocking: true }] } as LiveState, false)).toBeUndefined();
  expect(fallbackProgress({}, false)).toBeUndefined();
});

it('shows a stopped tool run neutrally, including after reopening its durable history', async () => {
  const started = Promise.withResolvers<void>();
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture', tools: [defineTool({ name: 'edit_note', description: 'Wait for an edit decision', parameters: Type.Object({}),
    async execute(_args, _api, context) {
      started.resolve();
      await new Promise<void>(resolve => context.abortSignal?.addEventListener('abort', () => resolve(), { once: true }));
      context.abortSignal?.throwIfAborted();
      return { output: [] };
    }
  })] }));
  const fixture = await piViewFixture({ registry });
  try {
    await fixture.binding.initialize();
    fixture.faux.setResponses([fauxAssistantMessage(fauxToolCall('edit_note', {}, { id: 'edit-1' }), { stopReason: 'toolUse' })]);
    const submission = (await fixture.binding.send('Propose an edit'))!;
    await started.promise;
    const id = String(fixture.binding.getSnapshot().conversation!.id);
    await fixture.binding.stop();
    expect(await submission.wait(PI_CONTEXT)).toMatchObject({ status: 'unanswered', reason: 'aborted' });
    const assertStopped = async () => {
      await vi.waitFor(() => expect(fixture.binding.getSnapshot().latestInput).toMatchObject({ status: 'unanswered', reason: 'aborted' }));
      const body = render(ChatPanel, { props: { binding: fixture.binding, autoInitialize: false } }).body;
      expect(body).toContain('data-testid="pi-stopped"');
      expect(body).toContain('Stopped.');
      expect(body).not.toContain('The response could not complete');
      expect(body).not.toContain('failed');
      expect(body).not.toContain('data-status="error"');
      expect(body).not.toContain('class="pi-error');
      expect(body).toContain('data-testid="pi-new-attempt"');
    };
    await assertStopped();
    await fixture.binding.select(null);
    await fixture.binding.select(id);
    await assertStopped();
  } finally { await fixture.close(); }
});
