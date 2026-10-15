import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { browser, $ } from '@wdio/globals';
import { createLiveNativeEvaluation, invokeNative as invoke } from '../../support/liveNative';
import { samplePaneMotion } from '../../support/paneMotion';

const live = process.env.GNEAUX_CHAT_NOTE_LIVE === '1' ? describe : describe.skip;
type Answer = {id: string; role: string; status: string; content: string; error?: string; agentEvents: unknown[]};
type Proposal = {id: string; assistantMessageId: string; status: string};
type Draft = {version: number; markdown: string; title: string; path: string; decisions: unknown[]};
live('local conversational chat-to-note', function () {
  this.timeout(660_000);
  const evaluation = createLiveNativeEvaluation();
  evaluation.installHooks();
  it('saves faithfully and refines the latest user-edited draft through the ordinary agent runtime', async () => {
    await evaluation.configure({access: 'full', lexicalOnly: true});
    const chat = await invoke<{id: string}>('chat_create_conversation', {request: {title: 'Live transfer', provider: 'local', model: process.env.GNEAUX_LIVE_MODEL!, access: 'full', reasoningEffort: 'medium'}});
    const vault = await invoke<{runningPath: string}>('get_vault_info');
    assert(vault.runningPath.includes('gneauxghts-native-e2e-'));
    execFileSync('python3', ['-c', `
import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('INSERT INTO chat_messages(id,conversation_id,ordinal,role,status,content,part,created_at_millis) VALUES(?,?,1,"assistant","complete",?,1,1)',('live-promotion-origin',sys.argv[2],'# Pilot\\n\\nThis is a deliberately long sentence describing our initial pilot plan.\\n\\nKeep the supporting detail.'))
` ,join(vault.runningPath, '.gneauxghts', 'ai.sqlite3'),chat.id]);
    await samplePaneMotion('open-chat');
    await $('[data-chat-message-id="live-promotion-origin"]').waitForExist();
    await $('textarea[aria-label="Message"]').setValue('Save your previous answer as a new note titled Pilot review. Transfer it faithfully for my review.');
    await $('button[aria-label="Send message"]').click();
    const saved = await evaluation.waitForAnswer<Answer>(chat.id, {excludeIds: ['live-promotion-origin']});
    assert.equal(saved.status, 'complete', saved.error);
    const proposals = await invoke<Proposal[]>('chat_list_pending_proposals', {conversationId: chat.id});
    assert.equal(proposals.length, 1, JSON.stringify(saved));
    const proposal = proposals[0];
    assert.equal(proposal.assistantMessageId, 'live-promotion-origin');
    const draft = await invoke<Draft>('chat_get_proposal_draft', {proposalId: proposal.id});
    assert(draft.markdown.includes('This is a deliberately long sentence describing our initial pilot plan.'));
    await $('[data-proposal-strip="active"]').waitForExist();
    const edited = draft.markdown + '\n\nMy handwritten detail must survive.';
    const editor = await $('[data-pane-kind="editor"] [data-testid="note-editor"] .cm-content');
    await browser.execute((el, value) => {
      (el as HTMLElement).focus();
      const bridge = (window as typeof window & {__GNEAUXGHTS_NATIVE_E2E__: {readEditorState: () => {editor: {markdown: string}}; setEditorSelection: (a: number,b: number) => boolean}}).__GNEAUXGHTS_NATIVE_E2E__;
      if (!bridge.setEditorSelection(0, bridge.readEditorState().editor.markdown.length)) throw new Error('Native selection failed');
      if (!document.execCommand('insertText', false, value)) throw new Error('Native edit failed');
    }, editor, edited);
    await $('textarea[aria-label="Message"]').setValue('In the pending Pilot review draft, replace only "This is a deliberately long sentence describing our initial pilot plan." with "Run one pilot." Keep every other word, including my handwritten detail and the chat link.');
    await $('button[aria-label="Send message"]').click();
    const refined = await evaluation.waitForAnswer<Answer>(chat.id, {excludeIds: ['live-promotion-origin', saved.id]});
    assert.equal(refined.status, 'complete', refined.error);
    const pending = await invoke<Proposal[]>('chat_list_pending_proposals', {conversationId: chat.id});
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, proposal.id);
    const latest = await invoke<Draft>('chat_get_proposal_draft', {proposalId: proposal.id});
    assert(latest.version > draft.version);
    assert(latest.markdown.includes('Run one pilot.'));
    assert(latest.markdown.includes('My handwritten detail must survive.'));
    assert(latest.markdown.includes('Keep the supporting detail.'));
    assert(latest.markdown.includes('|Open in chat]]'));
    assert.equal(pending[0].status, 'pending');
    evaluation.artifact.write({saveAnswer: saved, refineAnswer: refined, originalDraft: draft, userEditedMarkdown: edited, refinedDraft: latest, proposalId: proposal.id});
  });
});
