import assert from 'node:assert/strict';
import { browser } from '@wdio/globals';
import { createLiveNativeEvaluation, invokeNative as invoke, passageIds, resolvePassages } from '../../support/liveNative';
import { isTerminalAssistant } from '../../support/liveEvaluationArtifacts.mjs';

type Event = { type: string; status?: string; name?: string; callId?: string; durationMillis?: number; aggregate?: { totalTokens?: number } };
type Answer = { id: string; role: string; status: string; content: string; error?: string; sources: unknown[];
  agentEvents: { createdAtMillis: number; sequence: number; event: Event }[] };
const live = process.env.GNEAUX_LATENCY_NATIVE === '1' ? describe : describe.skip;

live('Local request latency decomposition in a disposable vault', function () {
  this.timeout(1_020_000);
  const evaluation = createLiveNativeEvaluation();
  evaluation.installHooks();
  it('measures short conversation and two independent activity requests', async () => {
    await evaluation.configure({ lexicalOnly: true });
    const model = process.env.GNEAUX_LIVE_MODEL!;
    const before = '# Meridian\n\n- [ ] Ancient backlog: redesign the logo\n\nInitial proposal: weekly exports.';
    const note = await evaluation.saveNote('Meridian activity regression', before);
    await invoke('chat_grant_note', { noteId: note.noteId });
    const after = new Date().toISOString();
    await evaluation.saveNote(note.title, before + '\n\n- [ ] Send Larissa the report\n\nPrepare an onboarding plan.\n\nExperimental pilot idea.', note.path);
    const until = new Date().toISOString();
    assert(after < until);
    await evaluation.saveNote(note.title, '# Meridian\n\n- [ ] Ancient backlog: redesign the logo\n\nInitial proposal: weekly exports.\n\n- [x] Send Larissa the report\n\nOnboarding plan superseded: arrange a vendor review instead.\n\nThe experimental pilot was canceled.', note.path);
    const question = `From what I worked on between ${after} (inclusive) and ${until} (exclusive), what are things I need to do now? Explain what changed and use the latest status. Keep the answer brief.`;
    const results: Record<string, unknown>[] = [];
    const persist = () => evaluation.artifact.write({ method: 'Production native IPC/runtime; synthetic disposable vault; lexical retrieval; timing proxy; no concurrent Rust suite. Polling costs include WebDriver transport.', model, after, until, results });
    for (const scenario of [
      { id: 'short-reply', question: 'Reply with just READY. Do not search or read notes.' },
      { id: 'activity-1', question }, { id: 'activity-2', question }
    ]) {
      const conversation = await invoke<{ id: string }>('chat_create_conversation', {
        request: { title: `Latency ${scenario.id}`, provider: 'local', model, access: 'approved', reasoningEffort: 'medium' }
      });
      const start = Date.now();
      let answer: Answer | undefined;
      let requestId: string | undefined;
      const polls: { startedAtMillis: number; elapsedMillis: number; sourceCount: number; status?: string }[] = [];
      const result: Record<string, unknown> = { ...scenario, conversationId: conversation.id, startedAtMillis: start, polls };
      results.push(result);
      try {
        const receipt = await invoke<{ requestId: string }>('chat_send_message', { request: {
          conversationId: conversation.id, content: scenario.question, attachments: [], activeNote: null,
          selectedContext: [], forceWebSearch: false
        } });
        requestId = receipt.requestId;
        result.admissionMillis = Date.now() - start;
        await browser.waitUntil(async () => {
          const polled = Date.now();
          const current = await invoke<{ messages: Answer[] }>('chat_get_conversation', { conversationId: conversation.id });
          answer = current.messages.find(message => message.role === 'assistant');
          polls.push({ startedAtMillis: polled, elapsedMillis: Date.now() - polled, sourceCount: answer?.sources.length ?? 0, status: answer?.status });
          result.answer = answer;
          evaluation.artifact.observeAnswer(conversation.id, answer);
          persist();
          const events = answer?.agentEvents ?? [];
          const modelCalls = events.filter(envelope => envelope.event.type === 'stepUpdated' && envelope.event.status === 'running').length;
          const toolCalls = events.filter(envelope => envelope.event.type === 'toolCallUpdated' && envelope.event.status === 'running').length;
          const tokens = Math.max(0, ...events.map(envelope => envelope.event.aggregate?.totalTokens ?? 0));
          if (!isTerminalAssistant(answer) && (modelCalls > 8 || toolCalls > 12 || tokens > 50_000))
            throw new Error('Observed diagnostic allowance exceeded');
          return isTerminalAssistant(answer);
        }, { timeout: 300_000, interval: 1000, timeoutMsg: 'Local latency request exceeded the original 300-second harness deadline' });
        result.terminalObservedMillis = Date.now() - start;
        assert(answer);
        const rereads: number[] = [];
        for (let i = 0; i < 3; i++) {
          const measured = Date.now();
          await invoke('chat_get_conversation', { conversationId: conversation.id });
          rereads.push(Date.now() - measured);
        }
        result.completedConversationReadMillis = rereads;
        const resolving = Date.now();
        result.resolutions = await resolvePassages(conversation.id, passageIds(answer.content));
        result.citationResolutionMillis = Date.now() - resolving;
        result.answer = answer;
        assert.equal(answer.status, 'complete', answer.error);
        if (scenario.id !== 'short-reply') assert(answer.sources.length > 0, 'Activity request must actually acquire evidence');
      } catch (error) {
        result.error = String(error);
        if (requestId && !isTerminalAssistant(answer)) {
          try { await invoke('chat_cancel_request', { requestId }); }
          catch (cancellationError) { result.cancellationError = String(cancellationError); }
        }
        persist();
        throw error;
      } finally {
        result.elapsedMillis = Date.now() - start;
        persist();
      }
    }
  });
});
