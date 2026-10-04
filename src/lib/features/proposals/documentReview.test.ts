import { describe, expect, it, vi } from 'vitest';
import { EditorDocumentRuntime } from '../notepad/editor/editorDocumentRuntime';
import { createRuntimePane } from '../notepad/editor/testSupport';
import { reviewProjection } from './reviewExtension';
import { documentRegistry } from '../notepad/document/documentRegistry';
import { createNoteDraftState } from '../notepad/state/noteStore';
import type { ProposalPreview } from '$lib/types/proposals';

const preview: ProposalPreview = {
  reviewId: 'review', notePath: '/note.md', title: 'Note', baseContentHash: 'hash',
  baseEditorMarkdown: 'before', proposedEditorMarkdown: 'after',
  hunks: [{ id: 'hunk', baseFrom: 0, baseTo: 6, proposedFrom: 0, proposedTo: 5, oldText: 'before', newText: 'after' }]
};
const callbacks = () => ({ onKeep: vi.fn(), onUndo: vi.fn(), onChange: vi.fn(), onMarkdownChange: vi.fn() });

describe('document-owned proposal review', () => {
  it('maps one root state, projects both panes, and resolves effects without another text edit', () => {
    const runtime = new EditorDocumentRuntime('before');
    const left = createRuntimePane(runtime, 'before', 2);
    const right = createRuntimePane(runtime, 'before', 5);
    right.setViewport(240);
    const events = callbacks();
    runtime.beginReview(preview, events);
    expect(runtime.markdown).toBe('after');
    expect(runtime.review?.hunks[0].status).toBe('pending');
    left.view.dispatch({ changes: { from: 0, to: 5, insert: 'my longer text' } });
    expect(runtime.review?.hunks[0]).toMatchObject({ from: 0, to: 14, status: 'modified' });
    expect(right.view.state.field(reviewProjection)).toBe(runtime.review);
    expect(left.view.state.field(reviewProjection)).toBe(runtime.review);
    expect(right.readViewport().scrollTop).toBe(240);
    const revision = runtime.revision;
    events.onMarkdownChange.mockClear();
    runtime.resolveReview('review', ['hunk'], 'kept');
    expect(runtime.review?.hunks[0].status).toBe('kept');
    expect(runtime.revision).toBe(revision);
    expect(events.onMarkdownChange).not.toHaveBeenCalled();
    expect(runtime.undo(right.controller.paneKey)).toBe(true);
    expect(runtime.markdown).toBe('after');
    runtime.endReview('review');
    runtime.destroy();
  });

  it('retains the root after the last pane leaves and edits without pane callbacks', () => {
    const document = createNoteDraftState();
    const resource = documentRegistry.ensure(document.handle).ensureResources({ assetRootPath: null, storePastedImage: vi.fn() });
    const runtime = resource.runtime;
    runtime.ensureMarkdown('before');
    const pane = createRuntimePane(runtime, 'before', 0);
    const events = callbacks();
    runtime.beginReview(preview, events);
    runtime.detachController(pane.controller);
    documentRegistry.dispose(document.handle);
    expect(documentRegistry.isReviewing(document.handle)).toBe(true);
    runtime.ensureMarkdown('stale saved body');
    expect(runtime.markdown).toBe('after');
    expect(documentRegistry.get(document.handle)?.resources()?.runtime).toBe(runtime);
    events.onMarkdownChange.mockClear();
    runtime.resolveReview('review', ['hunk'], 'undone', { from: 0, to: 5, insert: 'before' });
    expect(runtime.markdown).toBe('before');
    expect(events.onMarkdownChange).toHaveBeenCalledExactlyOnceWith('before');
    const remounted = createRuntimePane(runtime, runtime.markdown, 0);
    expect(remounted.view.state.field(reviewProjection)).toBe(runtime.review);
    runtime.endReview('review');
    documentRegistry.dispose(document.handle);
    expect(documentRegistry.get(document.handle)).toBeNull();
  });
});
