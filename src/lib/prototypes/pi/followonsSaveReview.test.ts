import { afterEach, describe, expect, it, vi } from 'vitest';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { documentRegistry } from '$lib/features/notepad/document/documentRegistry';
import { updateDocumentMarkdown } from '$lib/features/notepad/document/documentState';
import { createProposalReviewSession } from '$lib/features/proposals/reviewSession.svelte';
import { createProposalOrchestration } from '$lib/features/proposals/proposalOrchestration';
import type { DurableProposalReviewRequest } from '$lib/features/proposals/types';
import { createReviewEditorForTest } from '$lib/features/proposals/proposalEditorTestSupport';
import { createNotepadChatPaneAdapter } from '$lib/features/notepad/orchestration/notepadChatPaneAdapter';
import { createChatController } from '$lib/features/chat/controller.svelte';
import { fakeApi } from '$lib/features/chat/chatTestSupport';
import { Evidence } from './notesExtension';
import { stageReview, reviewExtension, readReview, checkpointReview, discardReview } from './reviews';
import { discardFollowonsSaveReview } from './followonsSaveReview';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
const harnesses: Harness[] = [];
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) dispose();
  await Promise.all(harnesses.splice(0).map(harness => harness.close(context)));
  for (const runtime of [...documentRegistry.values()]) documentRegistry.dispose(runtime.documentHandle);
});

async function setup(kind: 'create' | 'update') {
  const registry = createRegistry(); registry.install(reviewExtension(async () => 'full', () => 'answer'));
  const models = createModels(); models.setProvider(fauxProvider().provider);
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context); harnesses.push(harness);
  const conversation = await harness.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' } } });
  const base = kind === 'update' ? 'Saved answer' : '';
  const body = `${base}\n[Synthetic web source](https://example.com/pi-followons)\n\n[[Open in chat]]`;
  const preview = { reviewId: 'web-save', notePath: '/vault/Saved.md', title: 'Saved', baseContentHash: 'base', baseEditorMarkdown: base,
    proposedEditorMarkdown: body, hunks: [{ id: 'hunk', baseFrom: base.length, baseTo: base.length,
      proposedFrom: base.length, proposedTo: body.length, oldText: '', newText: body.slice(base.length) }] };
  let taskId = 0;
  await harness.commit(async tx => {
    (await tx.doc(Evidence, conversation.id)).access = 'full';
    taskId = await stageReview(tx, conversation.id, { kind, noteId: kind === 'update' ? 'note' : null, title: 'Saved',
      suggestedPath: preview.notePath, preview, payload: { markdown: body } }, 'answer', 'web-save');
  }, context);
  const id = `pi-review-${taskId}`;
  let draft = (await readReview(harness, id)).draft;
  const document = createNoteDraftState({ ...createEmptySessionSnapshot(), title: 'Saved', bodyMarkdown: base,
    currentNoteId: kind === 'update' ? 'note' : null, currentNotePath: kind === 'update' ? preview.notePath : null,
    lastSavedNoteId: kind === 'update' ? 'note' : null, lastSavedTitle: 'Saved', lastSavedMarkdown: base,
    lastSavedPath: kind === 'update' ? preview.notePath : null });
  const editor = createReviewEditorForTest(document);
  const session = createProposalReviewSession();
  const orchestration = createProposalOrchestration({ session, getEditorPaneDocument: () => document,
    getEditorForDocument: () => editor.adapter, presentReviewDocument: async () => document,
    onReviewMarkdownChange: updateDocumentMarkdown, finishReviewDocument: vi.fn(async () => {}),
    acknowledgeDocumentCommit: vi.fn(), reloadReviewDocument: vi.fn() });
  const request: DurableProposalReviewRequest = { proposalId: id, noteId: kind === 'update' ? 'note' : null, kind, preview, working: draft,
    checkpoint: async working => { draft = await checkpointReview(harness, id, { ...working, version: draft.version }, undefined, 'full'); },
    dismiss: async () => { await discardReview(harness, id); }, commit: vi.fn() };
  // Updates can passively mount in an open editor; creates use normal Review.
  expect(await (kind === 'update' ? orchestration.loadDurableProposalIfOpen(request) : orchestration.loadDurableProposal(request))).toBe(true);
  const controller = createChatController(fakeApi().api);
  const adapter = createNotepadChatPaneAdapter({ proposal: orchestration,
    coordinator: { getController: () => controller, getTargetAnchor: () => null, selectionActions: {} as never,
      setSurfaceHandle: vi.fn(), reviewAgentProposal: vi.fn() },
    getPaneOrder: () => ['chat', 'editor'], getPaneKind: pane => pane === 'chat' ? 'chat' : 'editor',
    getPaneDocument: () => document, setPaneDocument: vi.fn(), getPaneConversationId: () => 'chat',
    setPaneConversationId: vi.fn(), touchPaneLocation: vi.fn(), getPaneSelectedText: () => null,
    setActivePane: vi.fn(), openNote: vi.fn(), openWikilink: vi.fn(), openRevisionCitation: vi.fn(),
    flushPendingAutosave: vi.fn(), getNoteSaveQueue: vi.fn(async () => {}) });
  cleanup.push(() => { orchestration.dispose(); controller.dispose(); editor.dispose(); });
  return { harness, id, adapter, orchestration, session, body, draft };
}

describe('web Save setup leaves the next normal composer usable', () => {
  it('reproduces direct API dismissal retaining a review that rejects the next Send snapshot', async () => {
    const test = await setup('update');
    await discardReview(test.harness, test.id);
    expect(test.session.snapshot.proposalId).toBe(test.id);
    await expect(test.adapter.getBindings('chat').context.getActiveNoteSnapshot()).rejects.toThrow('Review already settled');
    // Explicit normal dismissal can still close this idempotently dismissed review.
    await test.orchestration.discard();
  });

  it.each(['create', 'update'] as const)('normally settles a passively mounted %s Save before the next Send snapshot', async kind => {
    const test = await setup(kind);
    expect(test.draft.markdown).toBe(test.body);
    const order: string[] = [];
    await discardFollowonsSaveReview({
      open: async id => { expect(test.session.snapshot.proposalId).toBe(id); order.push('mounted'); },
      discard: async id => { expect(test.session.snapshot.proposalId).toBe(id); await test.orchestration.undoAll(); order.push('normal discard'); },
      settled: async id => {
        expect((await readReview(test.harness, id)).proposal.status).toBe('dismissed');
        expect(test.session.snapshot.proposalId).toBeNull(); order.push('durable and mounted clear');
      }
    }, test.id);
    await expect(test.adapter.getBindings('chat').context.getActiveNoteSnapshot()).resolves.toEqual(kind === 'create' ? null : expect.objectContaining({ body: 'Saved answer', selection: null }));
    expect(order).toEqual(['mounted', 'normal discard', 'durable and mounted clear']);
  });
});
