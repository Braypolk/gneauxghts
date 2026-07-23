import { describe, expect, it, vi } from 'vitest';
import { createProposalOrchestration } from './proposalOrchestration';
import { createProposalReviewSession } from './reviewSession.svelte';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

describe('createProposalOrchestration chat completions', () => {
  it('ignores ordinary assistant messages before requiring an active note', async () => {
    const getEditorPaneDocument = vi.fn(() => null);
    const session = createProposalReviewSession();
    const orchestration = createProposalOrchestration({
      getEditorPaneDocument,
      getEditorForDocument: vi.fn(() => null),
      ensureEditorPaneForReview: vi.fn(async () => undefined),
      refreshDocumentAfterKeep: vi.fn(async () => undefined),
      session
    });

    await expect(orchestration.loadFromChatMessage('A normal conversational response.'))
      .resolves.toBe(false);
    expect(getEditorPaneDocument).not.toHaveBeenCalled();
    expect(session.snapshot.error).toBeNull();
  });

  it('uses the note context supplied by the chat pane throughout proposal loading', async () => {
    const path = '/vault/Fixture.md';
    const document = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Fixture',
      bodyMarkdown: '- salami',
      currentNotePath: path,
      lastSavedTitle: 'Fixture',
      lastSavedMarkdown: '- salami',
      lastSavedPath: path
    });
    const getEditorPaneDocument = vi.fn((requestedPath?: string | null) =>
      requestedPath === path ? document : null
    );
    const ensureEditorPaneForReview = vi.fn(async () => undefined);
    const activateEditorPane = vi.fn(async () => undefined);
    const session = createProposalReviewSession();
    const orchestration = createProposalOrchestration({
      getEditorPaneDocument,
      getEditorForDocument: vi.fn(() => null),
      ensureEditorPaneForReview,
      activateEditorPane,
      flushBeforePreview: vi.fn(async () => undefined),
      refreshDocumentAfterKeep: vi.fn(async () => undefined),
      session
    });
    const proposal = `\`\`\`gneauxghts-proposal
{"version":1,"edits":[{"kind":"insert","newText":"\\n- pizza","contextBefore":"- salami"}]}
\`\`\``;

    await expect(orchestration.loadFromChatMessage(proposal, {
      path,
      title: 'Fixture',
      lastSavedMarkdown: '- salami'
    })).resolves.toBe(false);

    expect(getEditorPaneDocument).toHaveBeenNthCalledWith(1, path);
    expect(getEditorPaneDocument).toHaveBeenLastCalledWith(path);
    expect(ensureEditorPaneForReview).toHaveBeenCalledWith(document);
    expect(activateEditorPane).toHaveBeenCalledWith(document);
    expect(session.snapshot.error).toBe('Editor is not ready for proposal review.');
  });

  it('surfaces malformed proposal payloads as review errors', async () => {
    const path = '/vault/Fixture.md';
    const document = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Fixture',
      bodyMarkdown: 'Body',
      currentNotePath: path,
      lastSavedTitle: 'Fixture',
      lastSavedMarkdown: 'Body',
      lastSavedPath: path
    });
    const session = createProposalReviewSession();
    const orchestration = createProposalOrchestration({
      getEditorPaneDocument: vi.fn(() => document),
      getEditorForDocument: vi.fn(() => null),
      ensureEditorPaneForReview: vi.fn(async () => undefined),
      flushBeforePreview: vi.fn(async () => undefined),
      refreshDocumentAfterKeep: vi.fn(async () => undefined),
      session
    });

    await expect(orchestration.loadFromChatMessage(
      '```gneauxghts-proposal\n{"version":1,"edits":[]}\n```',
      { path, title: 'Fixture', lastSavedMarkdown: 'Body' }
    )).resolves.toBe(false);

    expect(session.snapshot.error).toBe('The assistant returned a proposal that could not be read.');
  });

  it('surfaces save failures that occur before preview', async () => {
    const path = '/vault/Fixture.md';
    const document = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      title: 'Fixture',
      bodyMarkdown: 'Body',
      currentNotePath: path,
      lastSavedTitle: 'Fixture',
      lastSavedMarkdown: 'Body',
      lastSavedPath: path
    });
    const ensureEditorPaneForReview = vi.fn(async () => undefined);
    const session = createProposalReviewSession();
    const orchestration = createProposalOrchestration({
      getEditorPaneDocument: vi.fn(() => document),
      getEditorForDocument: vi.fn(() => null),
      ensureEditorPaneForReview,
      flushBeforePreview: vi.fn(async () => {
        throw new Error('Could not save the note before review.');
      }),
      refreshDocumentAfterKeep: vi.fn(async () => undefined),
      session
    });

    await expect(orchestration.loadFromChatMessage(
      '```gneauxghts-proposal\n{"version":1,"edits":[{"kind":"replace","oldText":"Body","newText":"Next"}]}\n```',
      { path, title: 'Fixture', lastSavedMarkdown: 'Body' }
    )).resolves.toBe(false);

    expect(ensureEditorPaneForReview).not.toHaveBeenCalled();
    expect(session.snapshot.error).toBe('Could not save the note before review.');
  });
});
