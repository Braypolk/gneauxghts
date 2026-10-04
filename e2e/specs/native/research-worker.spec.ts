import assert from 'node:assert/strict';
import { createLiveNativeEvaluation, invokeNative as invoke } from '../../support/liveNative';

type Answer = {
  role: string;
  status: string;
  error?: string;
  content: string;
  sources: Array<{
    noteId?: string;
    passage?: {
      id: string;
      location: string;
      historical?: unknown;
    };
  }>;
  agentEvents: Array<{
    event: {
      type: string;
      name?: string;
      details?: Record<string, unknown>;
    };
  }>;
};

const live = process.env.GNEAUX_RESEARCH_NATIVE === '1' ? describe : describe.skip;

live('Bounded research worker through the real chat runtime', function() {
  this.timeout(900_000);
  const evaluation = createLiveNativeEvaluation();
  evaluation.installHooks();
  it('delivers actually read current and retained historical passages', async () => {
    const endpoint = process.env.GNEAUX_LIVE_ENDPOINT, model = process.env.GNEAUX_LIVE_MODEL, output = process.env.GNEAUX_LIVE_OUTPUT;
    assert(endpoint && model && output, 'Explicit local model and output path required');
    await evaluation.configure();
    const save = evaluation.saveNote;
    const note = await save('Meridian research fixture', '# Meridian\n\nUnchanged background.');
    await invoke('chat_grant_note', { noteId: note.noteId });
    const start = new Date().toISOString();
    await save(note.title, '# Meridian\n\nUnchanged background.\n\n- [ ] Send Larissa the report.\n\nPrepare an onboarding plan.\n\nExperimental pilot idea.', note.path);
    const end = new Date().toISOString();
    await save(note.title, '# Meridian\n\nUnchanged background.\n\n- [x] Send Larissa the report.\n\n- [ ] Send Rhea the final contract.', note.path);
    const related = await save('Meridian vendor status', '# Meridian vendor status\n\nVendor review is now recorded complete.');
    await invoke('chat_grant_note', { noteId: related.noteId });
    const excluded = await save('Excluded research fixture', 'CANARY_RESEARCH_491');
    await invoke('chat_set_note_excluded', {
      noteId: excluded.noteId, title: excluded.title, excluded: true
    });
    const results: Array<{
      scenario: string;
      question: string;
      answer?: Answer;
    }> = [];
    const record = () => {
      evaluation.artifact.write({
        endpoint, model, start, end, results
      });
    };
    for (const scenario of ['current', 'historical', 'discovery', 'fallback', 'composed']) {
      const historical = scenario !== 'current';
      const conversation: { id: string } = await invoke<{
        id: string;
      }>('chat_create_conversation', {
        request: {
          title: 'Worker evidence regression', provider: 'local', model, access: 'approved', reasoningEffort: 'medium'
        }
      });
      const question = scenario === 'composed'
        ? `Use research_notes to gather the specific Meridian passages changed between ${start} and ${end}, then independently read current related notes and tell me what remains to do. Use direct evidence if research cannot finish.`
        : scenario === 'fallback'
          ? `Call research_notes with question "Find the recorded outstanding contract commitment", note_ids ["${excluded.noteId}"]. If this scope is unavailable, disclose the gap and use read_evidence with note_id "${note.noteId}" to quote the current outstanding contract commitment.`
          : scenario === 'discovery'
            ? `Use research_notes to gather the specific Meridian passages changed between ${start} and ${end}. Quote its delivered changed passages. Do not independently retrieve evidence for this worker test.`
            : historical
              ? `Call research_notes with question "Find the recorded added report commitment", note_ids ["${note.noteId}"], include_history true and activity_range start "${start}" end "${end}". Use its delivered evidence to quote the changed commitment. Do not independently retrieve evidence for this worker test.`
              : `Call research_notes with question "Find the recorded outstanding contract commitment", note_ids ["${note.noteId}"]. Use its delivered evidence to quote the outstanding commitment. Do not independently retrieve evidence for this worker test.`;
      const result: {
        scenario: string;
        question: string;
        answer?: Answer;
      } = { scenario, question };
      results.push(result);
      await invoke('chat_send_message', {
        request: {
          conversationId: conversation.id, content: question, attachments: [], activeNote: null, selectedContext: [], forceWebSearch: false
        }
      });
      try {
        result.answer = await evaluation.waitForAnswer<Answer>(conversation.id, {
          onUpdate: answer => { result.answer = answer; }
        });
      }
      finally {
        record();
      }
      assert(result.answer);
      assert.equal(result.answer.status, 'complete', result.answer.error);
      assert(!JSON.stringify(result.answer).includes('CANARY_RESEARCH_491'));
      for (const source of result.answer.sources)
        if (source.passage)
          await invoke('chat_resolve_passage', { conversationId: conversation.id, evidenceId: source.passage.id });
    }
    for (const { scenario, answer } of results) {
      assert(answer);
      const completed = answer.agentEvents.filter(e => e.event.type === 'researchCompleted').map(e => e.event.details);
      if (scenario === 'fallback') {
        assert(completed.some(d => d?.outcome === 'partial' && d.reason === 'empty_scope' && Number(d.readPassages) === 0 && Number(d.deliveredPassages) === 0), 'Excluded scope must fail explicitly without worker reads');
      }
      else {
        assert(completed.some(d => ['ready', 'partial'].includes(String(d?.outcome)) && d?.reason === 'validated' && Number(d.readCalls) > 0 && Number(d.readPassages) > 0 && Number(d.deliveredPassages) > 0), `${scenario}: worker must deliver validated read evidence, not parent fallback: ${JSON.stringify(completed)}`);
        if (scenario !== 'composed')
          assert(answer.agentEvents.every(e => e.event.type !== 'toolCallUpdated' || !['read_evidence', 'search_evidence', 'list_note_activity'].includes(e.event.name ?? '')), 'Parent must not substitute direct retrieval for worker success');
        if (process.env.GNEAUXGHTS_CONTEXT_DIAGNOSTICS === '1')
          assert(answer.agentEvents.some(e => e.event.type === 'contextMeasured' && e.event.details?.worker === true && e.event.details.phase === 'request' && e.event.details.executableToolCount === 3 && e.event.details.resultFormatterCount === 1), 'Worker assembled request must expose three evidence tools and the structured result formatter');
      }
      assert(answer.sources.some(s => s.noteId === note.noteId && s.passage?.location === 'body' && Boolean(s.passage.historical) === (!['current', 'fallback'].includes(scenario)) && answer.content.includes(`passage:${s.passage.id}`)), `${scenario}: answer must cite delivered body evidence`);
      if (scenario === 'composed') {
        assert(answer.sources.some(s => s.noteId === note.noteId && s.passage?.location === 'body' && !s.passage.historical && answer.content.includes(`passage:${s.passage.id}`)), 'Composed answer must freshly read and cite current status');
        assert(answer.sources.some(s => s.noteId === related.noteId && s.passage?.location === 'body' && !s.passage.historical && answer.content.includes(`passage:${s.passage.id}`)), 'Composed answer must read and cite related current status');
      }
    }
  });
});
