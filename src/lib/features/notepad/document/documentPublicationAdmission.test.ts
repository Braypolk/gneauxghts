import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentEditingService } from './documentEditingService';
import { createNoteDraftState, createNotepadState, adoptCommittedDocument, upsertNote } from '../state/noteStore';
import { updateDocumentMarkdown, updateDocumentTitle, updateDocumentTags } from './documentState';
import { documentRegistry } from './documentRegistry';
import { createRuntimePane } from '../editor/testSupport';
import type { NoteSession } from '../model/types';

const base: NoteSession = { noteId: 'note-1', path: '/vault/Note.md', title: 'Note', markdown: 'Before', tags: ['old'] };
const target = { noteId: base.noteId, path: base.path! };

function fixture() {
  const document = createNoteDraftState();
  const state = createNotepadState(document, '/vault');
  adoptCommittedDocument(state, document, base);
  const runtime = documentRegistry.ensure(document.handle);
  const root = runtime.ensureResources({ assetRootPath: null, storePastedImage: vi.fn() }).runtime;
  root.ensureMarkdown(base.markdown);
  let titleEditing = false;
  const read = vi.fn(async () => ({ ...base }));
  const changed = vi.fn();
  const service = createDocumentEditingService({
    state, isApplyingProgrammaticUpdate: () => false,
    isTitleEditing: () => titleEditing, resetPaneCommandAfterBodyInput: vi.fn(),
    clearRecentlyForgotten: vi.fn(),
    scheduleAutosave: vi.fn(), scheduleSearch: vi.fn(), scheduleRelated: vi.fn(),
    readPublicationSession: read, publicationAdmissionChanged: changed
  });
  return { document, state, runtime, root, service, read, changed, editTitle: () => { titleEditing = true; } };
}

afterEach(() => {
  for (const runtime of [...documentRegistry.values()]) documentRegistry.dispose(runtime.documentHandle);
});

describe('document publication admission', () => {
  it.each(['body', 'title', 'tags', 'titleDraft', 'conflict', 'collision', 'runtime'] as const)('rejects %s without publishing or saving human changes', async kind => {
    const f = fixture();
    if (kind === 'body') updateDocumentMarkdown(f.document, 'Human draft');
    if (kind === 'title') updateDocumentTitle(f.document, 'Human title');
    if (kind === 'tags') updateDocumentTags(f.document, ['human']);
    if (kind === 'titleDraft') f.editTitle();
    if (kind === 'conflict') f.document.externalSync = { kind: 'conflict', sequence: 1, conflictId: 1, phase: 'awaitingChoice', external: { kind: 'deletion', source: 'watcher', path: base.path! } };
    if (kind === 'collision') f.document.canonicalCollision = { otherHandle: 'document:other', noteId: base.noteId, path: base.path! };
    if (kind === 'runtime') f.root.replaceMarkdown('Unrecorded human input', { notifyMarkdownChange: false });
    const effect = vi.fn();
    await expect(f.service.withAgentPublication(target, effect)).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
    expect(f.service.isAgentPublicationActive()).toBe(false);
  });

  it('freezes split roots, title/tags/programmatic edits and disposal before joining an existing save queue', async () => {
    const f = fixture();
    const first = createRuntimePane(f.root, base.markdown, 0);
    const second = createRuntimePane(f.root, base.markdown, 0);
    const queue = Promise.withResolvers<void>();
    const queued = f.runtime.requestSave(() => queue.promise);
    const effect = vi.fn(async () => 'published');
    const publishing = f.service.withAgentPublication(target, effect);
    expect(effect).not.toHaveBeenCalled();
    expect(f.service.isAgentPublicationActive()).toBe(true);
    first.view.dispatch({ changes: { from: 0, insert: 'typed' } });
    second.view.dispatch({ changes: { from: 0, insert: 'sibling' } });
    expect(f.root.markdown).toBe(base.markdown);
    expect(first.readState().doc.toString()).toBe(base.markdown);
    expect(second.readState().doc.toString()).toBe(base.markdown);
    expect(f.root.undo(first.controller.paneKey)).toBe(false);
    expect(() => updateDocumentTitle(f.document, 'Changed')).toThrow();
    expect(() => updateDocumentTags(f.document, ['changed'])).toThrow();
    await expect(f.service.replaceMarkdown(f.document, 'Programmatic', async () => {})).rejects.toThrow();
    expect(() => documentRegistry.dispose(f.document.handle)).toThrow();
    queue.resolve();
    await queued;
    await expect(publishing).resolves.toBe('published');
    expect(f.changed.mock.calls).toEqual([[true], [false]]);
    first.view.dispatch({ changes: { from: 0, insert: 'allowed' } });
    expect(f.root.markdown).toBe('allowedBefore');
  });

  it('protects unopened targets against opening while native execution is pending', async () => {
    const f = fixture();
    const pending = Promise.withResolvers<void>();
    const publishing = f.service.withAgentPublication({ noteId: 'unopened', path: '/vault/Unopened.md' }, () => pending.promise);
    expect(() => upsertNote(f.state, createNoteDraftState())).toThrow();
    pending.resolve();
    await publishing;
    expect(() => upsertNote(f.state, createNoteDraftState())).not.toThrow();
  });

  it('adopts canonical bytes and warning through the existing retained root', async () => {
    const f = fixture();
    const first = createRuntimePane(f.root, base.markdown, 2);
    const committed = { ...base, markdown: 'After', tags: ['old'], commitWarning: { message: 'Capture pending', issues: [{ stage: 'historyFinalization', message: 'Retry recovery' }] } };
    f.read.mockResolvedValue(committed);
    await f.service.withAgentPublication(target, async lease => {
      expect(await lease.adopt({ ...target, markdown: committed.markdown, commitWarning: committed.commitWarning })).toBe('adopted');
    });
    expect(f.document.savedBaseline?.content.markdown).toBe('After');
    expect(f.document.publication.warning).toEqual(committed.commitWarning);
    expect(first.readState().doc.toString()).toBe('After');
    expect(documentRegistry.get(f.document.handle)?.resources()?.runtime).toBe(f.root);
  });

  it('preserves human content when canonical read-back differs from the receipt', async () => {
    const f = fixture();
    f.read.mockResolvedValue({ ...base, markdown: 'Newer disk content' });
    await f.service.withAgentPublication(target, async lease => {
      expect(await lease.adopt({ ...target, markdown: 'Historical publication' })).toBe('conflict');
    });
    expect(f.document.working.markdown).toBe('Before');
    expect(f.document.savedBaseline?.content.markdown).toBe('Before');
    expect(f.document.externalSync.kind).toBe('conflict');
  });

  it('retains protection after uncertain native settlement until the host joins it', async () => {
    const f = fixture();
    await expect(f.service.withAgentPublication(target, async lease => {
      lease.retainUntilSettled();
      throw new Error('Native settlement acknowledgement lost');
    })).rejects.toThrow('acknowledgement');
    expect(() => updateDocumentMarkdown(f.document, 'Too early')).toThrow();
    await expect(f.service.withAgentPublication(target, async () => {})).rejects.toThrow();
    f.service.releaseSettledAgentPublication();
    expect(() => updateDocumentMarkdown(f.document, 'After settlement')).not.toThrow();
    expect(f.service.isAgentPublicationActive()).toBe(false);
  });
});
