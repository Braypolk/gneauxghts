import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { EditorView } from '@codemirror/view';
import ChatProposalRegion from '$lib/features/chat/ui/ChatProposalRegion.svelte';
import type { ChatController } from '$lib/features/chat/controller.svelte';
import type { ChatAgentProposal, ChatProposalDraft } from '$lib/features/chat/types';
const mocks = vi.hoisted(() => ({ draft: vi.fn(), openChat: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('$lib/features/chat/api', () => ({ chatApi: { getProposalDraft: mocks.draft } }));
vi.mock('./nativeProvider', () => ({ nativeTransportStats: {} }));
vi.mock('./probeChatFocus', async original => ({ ...await original<typeof import('./probeChatFocus')>(), openVisibleProbeChat: mocks.openChat }));
import { currentReview } from './interactiveProbe';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); mocks.draft.mockReset(); mocks.openChat.mockReset(); });
describe('normal active proposal review acquisition after refinement', () => {
  it('opens the real active strip when its queued card is intentionally absent and waits for the exact refined editor', async () => {
    vi.useFakeTimers();
    const proposalId = 'pi-review-148', reviewId = 'refined-review';
    const draft: ChatProposalDraft = { version: 8, title: 'Refined title', path: '/synthetic/Chats/Pi/Refined title.md',
      markdown: 'Human text.\n\nModel refinement of that exact latest text.', decisions: [] };
    const proposal: ChatAgentProposal = { id: proposalId, conversationId: 'pi-4', assistantMessageId: 'pi-assistant-147', runId: null,
      kind: 'create', noteId: null, title: draft.title, suggestedPath: draft.path, baseHash: null,
      payload: { markdown: draft.markdown }, preview: { reviewId }, status: 'pending', createdAtMillis: 1, updatedAtMillis: 2 };
    const markup = render(ChatProposalRegion, { props: { controller: {} as ChatController, proposals: [proposal],
      visibleProposalSnapshot: { proposalId, notePath: draft.path, title: draft.title, totalHunks: 1, unresolvedHunks: 1,
        isApplying: false, isConflicted: false, error: null, creation: true },
      onProposalReview: () => {}, onReviewAgentProposal: () => {} } }).body;
    expect(markup).not.toContain(`<section data-proposal-id="${proposalId}"`);
    expect(markup).toContain('data-proposal-strip="active"'); expect(markup).not.toContain('Review in editor');
    const labels = [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => match[1].replace(/<[^>]*>/g, '').trim());
    expect(labels).toContain('Review next');
    let refreshed = false, presented = false;
    const controls = labels.map(textContent => ({ textContent, disabled: false, getAttribute: () => null,
      click: vi.fn(() => { if (textContent === 'Review next') { refreshed = true; setTimeout(() => { presented = true; }, 60); } }) }));
    const strip = { getAttribute: (name: string) => name === 'data-proposal-strip' ? 'active' : null,
      querySelectorAll: () => controls };
    const pane = { querySelector: () => ({ value: draft.title }) };
    const dom = { isConnected: true, closest: (selector: string) => selector === '[data-testid="workspace-pane"]' ? pane : null,
      getClientRects: () => [1] };
    const staleView = { dom,
      state: { doc: { toString: () => 'Human text.' }, field: () => ({ reviewId: 'old-review', hunks: [] }) } } as unknown as EditorView;
    const exactState = { doc: { toString: () => draft.markdown }, field: () => ({ reviewId, hunks: [] }) };
    const hiddenExactView = { dom: { ...dom, getClientRects: () => [] }, state: exactState } as unknown as EditorView;
    const exactView = { dom: { ...dom, getClientRects: () => presented ? [1] : [] }, state: exactState } as unknown as EditorView;
    const querySelector = vi.fn((selector: string) => selector === `[data-proposal-strip="active"][data-proposal-id="${proposalId}"]` ? strip : null);
    vi.stubGlobal('document', { querySelector, querySelectorAll: () => [{ view: hiddenExactView }, { view: refreshed ? exactView : staleView }] });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    vi.spyOn(EditorView, 'findFromDOM').mockImplementation(node => (node as unknown as { view: EditorView }).view);
    mocks.draft.mockResolvedValue(draft); mocks.openChat.mockResolvedValue(undefined);
    let settled = false;
    const opening = currentReview(proposalId, reviewId).then(view => { settled = true; return view; });
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshed).toBe(true); expect(presented).toBe(false); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(await opening).toBe(exactView);
    expect(mocks.draft).toHaveBeenCalledExactlyOnceWith(proposalId);
    expect(querySelector).toHaveBeenCalledWith(`section[data-proposal-id="${proposalId}"]`);
    expect(controls.find(control => control.textContent === 'Review next')!.click).toHaveBeenCalledOnce();
    for (const control of controls.filter(control => control.textContent !== 'Review next')) expect(control.click).not.toHaveBeenCalled();
  });
});
