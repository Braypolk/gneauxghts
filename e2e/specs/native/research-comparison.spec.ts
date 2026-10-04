import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLiveNativeEvaluation, invokeNative as invoke, passageIds, resolvePassages } from '../../support/liveNative';

type Note = { noteId: string; path: string; title: string };
type Source = { noteId?: string; excerpt?: string; passage?: { id: string } };
type Event = { type: string; name?: string; status?: string; details?: Record<string, unknown> };
type Message = { id: string; role: string; status: string; content: string; error?: string; sources: Source[]; agentEvents: { event: Event }[] };
type Conversation = { id: string; messages: Message[] };
type Question = { id: string; query: string; rubric: string; expectedPassages: { note: string; text: string }[] };

const autonomous = process.env.GNEAUX_AGENT_SIMPLIFICATION === '1';
const reasoningEffort = process.env.GNEAUX_LIVE_REASONING_EFFORT ?? 'medium';
assert(['low', 'medium', 'xhigh'].includes(reasoningEffort), 'Unknown Qwen reasoning effort');
const reverseOrder = process.env.GNEAUX_COMPARISON_REVERSE === '1' || (autonomous && process.env.GNEAUX_AGENT_VARIANT !== 'baseline');
const live = autonomous || process.env.GNEAUX_RESEARCH_COMPARISON === '1' ? describe : describe.skip;
const fixture = JSON.parse(readFileSync(resolve(autonomous ? 'e2e/fixtures/autonomous-agent.json' : 'src-tauri/src/services/evidence/harder_fixtures.json'), 'utf8')) as {
  notes: { id: string; title: string; body: string }[]; questions: Question[];
};
const selected = (autonomous ? fixture.questions.map(q => q.id) : ['opaque_chain', 'constraint_join', 'revised_decision']).filter(id => !process.env.GNEAUX_COMPARISON_CASE || id === process.env.GNEAUX_COMPARISON_CASE);
if (reverseOrder) selected.reverse();
assert(selected.length > 0, 'Case filter matched no cases');
assert(!process.env.GNEAUX_COMPARISON_LANE || ['direct', 'research'].includes(process.env.GNEAUX_COMPARISON_LANE), 'Unknown lane');
assert(!autonomous || ['baseline', 'lean', 'lean_contract'].includes(process.env.GNEAUX_AGENT_VARIANT ?? ''), 'Specify the built agent variant');
assert(!autonomous || !process.env.GNEAUX_COMPARISON_LANE, 'Autonomous comparison must not force routing');
live('Native direct versus research on identical harder questions', function () {
  this.timeout(360_000);
  const evaluation = createLiveNativeEvaluation();
  evaluation.installHooks();
  const endpoint = process.env.GNEAUX_LIVE_ENDPOINT!;
  const model = process.env.GNEAUX_LIVE_MODEL!;
  const output = process.env.GNEAUX_LIVE_OUTPUT!;
  const notes = new Map<string, Note>();
  const results: Record<string, unknown>[] = [];
  function persist() {
    evaluation.artifact.write({ endpoint, model, reasoningEffort, reverseOrder, method: autonomous ? 'Native autonomous agent; plain user questions, no forced tool route; fresh conversations; lexical only; recorded configuration and case order' : 'Native ChatService and AgentRuntime; fresh conversations; lexical only; same question and fixture, routing instruction differs; candidate lane order alternates before filtering; results record actual execution order', variant: autonomous ? process.env.GNEAUX_AGENT_VARIANT : null, caseFilter: process.env.GNEAUX_COMPARISON_CASE ?? null, laneFilter: process.env.GNEAUX_COMPARISON_LANE ?? null, notes: Object.fromEntries(notes), results });
  }
  evaluation.setup(async () => {
    assert(endpoint && model && output);
    await evaluation.configure({ reasoningEffort, lexicalOnly: true });
    for (const n of fixture.notes) {
      const note = await evaluation.saveNote(n.title, n.body);
      notes.set(n.id, note);
      if (n.id === 'private') await invoke('chat_set_note_excluded', { noteId: note.noteId, title: note.title, excluded: true });
      else await invoke('chat_grant_note', { noteId: note.noteId });
    }
    persist();
  });
  for (const [index, id] of selected.entries()) {
    const question = fixture.questions.find(q => q.id === id)!;
    assert(question);
    for (const lane of (autonomous ? ['autonomous'] : index % 2 ? ['research', 'direct'] : ['direct', 'research']).filter(lane => !process.env.GNEAUX_COMPARISON_LANE || lane === process.env.GNEAUX_COMPARISON_LANE)) {
      it(`${id}: ${lane}`, async () => {
        const routing = autonomous ? '' : lane === 'direct'
          ? 'Use iterative search_evidence and read_evidence directly; do not call research_notes.'
          : 'Use research_notes exactly once to investigate this question, then answer from validated evidence. Do not treat failed research as successful.';
        const content = autonomous ? question.query : `${question.query}\n\n${routing} Cite supporting sources, disclose missing evidence, and distinguish an absent completion record from proof that an event did not happen.`;
        const conversation = await invoke<Conversation>('chat_create_conversation', { request: { title: `${id} ${lane}`, provider: 'local', model, access: 'approved', reasoningEffort } });
        const start = Date.now();
        await invoke('chat_send_message', { request: { conversationId: conversation.id, content, activeNote: null, attachments: [], selectedContext: [], forceWebSearch: false } });
        const answer = await evaluation.waitForAnswer<Message>(conversation.id);
        const latencyMillis = Date.now() - start;
        const links = passageIds(answer.content);
        const resolutions = await resolvePassages(conversation.id, links);
        const events = answer.agentEvents.map(e => e.event);
        const diagnostics = events.filter(e => e.type === 'researchCompleted').map(e => e.details!);
        const measurements = events.filter(e => e.type === 'contextMeasured').map(e => e.details!);
        const requests = measurements.filter(m => m.phase === 'request');
        const usages = measurements.filter(m => m.phase === 'usage');
        const missingUsageAttempts = requests.filter(r => !usages.some(u => u.runtimeInstance === r.runtimeInstance && u.attempt === r.attempt && u.reportedUsage)).length;
        const unreportedAttempts = measurements.filter(m => m.phase === 'unreported').length;
        const totals = usages.reduce<{ input: number; output: number; total: number }>((sum, e) => {
          const usage = e.reportedUsage as { inputTokens: number; outputTokens: number; totalTokens: number };
          if (usage) { sum.input += usage.inputTokens; sum.output += usage.outputTokens; sum.total += usage.totalTokens; }
          return sum;
        }, { input: 0, output: 0, total: 0 });
        const coverage = question.expectedPassages.map(gold => ({ ...gold,
          admitted: answer!.sources.some(s => s.noteId === notes.get(gold.note)!.noteId && s.excerpt?.includes(gold.text)),
          cited: answer!.sources.some(s => s.noteId === notes.get(gold.note)!.noteId && s.excerpt?.includes(gold.text) && s.passage && links.includes(s.passage.id))
        }));
        results.push({ id, lane, question: question.query, routing, rubric: question.rubric, status: answer.status, error: answer.error, answer: answer.content, latencyMillis, coverage, diagnostics, totals, parentCalls: requests.filter(u => !u.worker).length, workerCalls: requests.filter(u => u.worker).length, missingUsageAttempts, unreportedAttempts, tokenCoverage: missingUsageAttempts ? 'partial' : 'complete', sources: answer.sources, resolutions, events });
        persist();
        assert.equal(answer.status, 'complete', answer.error);
        assert(links.length > 0, 'Known-match comparison fixtures require cited evidence');
        assert(resolutions.every(r => r.status === 'resolved'));
        assert(!answer.sources.some(s => s.noteId === notes.get('private')!.noteId));
        if (lane === 'direct') assert.equal(diagnostics.length, 0, 'Direct must not delegate');
        else if (lane === 'research') {
          assert.equal(diagnostics.length, 1, 'Research must actually execute once');
          assert.equal(diagnostics[0].reason, 'validated', JSON.stringify(diagnostics));
          assert(Number(diagnostics[0].deliveredPassages) > 0, 'A known-match fixture requires actual research evidence');
        }
        assert(usages.length > 0, 'Capture actual provider usage');
        // Factual correctness is graded against the pre-existing rubric after the
        // run. Retrieved/cited coverage alone is not an answer-grounding score.
      });
    }
  }
});
