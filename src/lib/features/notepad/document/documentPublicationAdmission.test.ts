import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentEditingService } from './documentEditingService';
import { createNoteDraftState, createNotepadState, adoptCommittedDocument, upsertNote, findOpenDocument } from '../state/noteStore';
import { dispatchDocumentOperation, getDocumentNoteId, getDocumentPath, getDocumentTitle, updateDocumentMarkdown, updateDocumentTitle, updateDocumentTags } from './documentState';
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
    if (kind === 'runtime') f.root.replaceMarkdown('Unrecorded human input', { notifyBodyChange: false });
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
    expect(f.document.savedBaseline?.content.body.toMarkdown()).toBe('After');
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
    expect(f.document.working.body.toMarkdown()).toBe('Before');
    expect(f.document.savedBaseline?.content.body.toMarkdown()).toBe('Before');
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

  it.each(['body', 'titleDraft', 'conflict', 'runtime'] as const)('admits both rename locations and blocks a %s destination without changing either document', async kind => {
    const f = fixture();
    const destination = { ...base, noteId: 'destination-identity', path: '/vault/Renamed.md', title: 'Renamed' };
    const other = createNoteDraftState(); upsertNote(f.state, other); adoptCommittedDocument(f.state, other, destination);
    const root = documentRegistry.ensure(other.handle).ensureResources({ assetRootPath: null, storePastedImage: vi.fn() }).runtime;
    root.ensureMarkdown(destination.markdown);
    if (kind === 'body') updateDocumentMarkdown(other, 'Unsaved destination');
    if (kind === 'titleDraft') f.editTitle();
    if (kind === 'conflict') other.externalSync = { kind: 'conflict', sequence: 1, conflictId: 1, phase: 'awaitingChoice', external: { kind: 'deletion', source: 'watcher', path: destination.path } };
    if (kind === 'runtime') root.replaceMarkdown('Unrecorded destination input', { notifyBodyChange: false });
    const effect = vi.fn();
    await expect(f.service.withAgentPublication({ ...target, destinationPath: destination.path }, effect)).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
    expect(getDocumentPath(f.document)).toBe(base.path);
    expect(getDocumentNoteId(other)).toBe(destination.noteId);
    expect(getDocumentPath(other)).toBe(destination.path);
  });

  it('freezes clean destination buffers while a rename settles without adopting a different identity', async () => {
    const f = fixture();
    const other = createNoteDraftState(); upsertNote(f.state, other);
    const destination = { ...base, noteId: 'destination-identity', path: '/vault/Renamed.md', title: 'Renamed' };
    adoptCommittedDocument(f.state, other, destination);
    const pending = Promise.withResolvers<void>();
    const publishing = f.service.withAgentPublication({ ...target, destinationPath: destination.path }, () => pending.promise);
    expect(() => updateDocumentMarkdown(other, 'Concurrent destination edit')).toThrow();
    expect(() => updateDocumentMarkdown(f.document, 'Concurrent source edit')).toThrow();
    pending.resolve(); await publishing;
    expect(getDocumentNoteId(other)).toBe(destination.noteId);
    expect(() => updateDocumentMarkdown(other, 'After settlement')).not.toThrow();
  });

  it('adopts a rename in both panes under the retained handle, lookup and shared Undo root', async () => {
    const f = fixture(); const handle = f.document.handle;
    const first = createRuntimePane(f.root, base.markdown, 2);
    const second = createRuntimePane(f.root, base.markdown, 4);
    first.view.dispatch({ changes: { from: 6, insert: ' saved' }, userEvent: 'input.type' });
    const saved = { ...base, markdown: 'Before saved' };
    adoptCommittedDocument(f.state, f.document, saved);
    const renamed = { ...saved, title: 'Renamed', path: '/vault/Renamed.md' };
    f.read.mockResolvedValue(renamed);
    await f.service.withAgentPublication({ ...target, destinationPath: renamed.path }, async lease => {
      expect(await lease.adopt({ noteId: base.noteId, path: renamed.path, markdown: renamed.markdown })).toBe('adopted');
    });
    expect(f.document.handle).toBe(handle);
    expect(Object.keys(f.state.documentsByHandle)).toEqual([handle]);
    expect(getDocumentPath(f.document)).toBe(renamed.path);
    expect(getDocumentTitle(f.document)).toBe('Renamed');
    expect(getDocumentNoteId(f.document)).toBe(base.noteId);
    expect(findOpenDocument(f.state, { noteId: base.noteId, path: renamed.path })).toBe(f.document);
    expect(findOpenDocument(f.state, { noteId: null, path: base.path })).toBeNull();
    expect(first.readState().doc.toString()).toBe(renamed.markdown);
    expect(second.readState().doc.toString()).toBe(renamed.markdown);
    expect(documentRegistry.get(handle)?.resources()?.runtime).toBe(f.root);
    expect(f.root.undo(second.controller.paneKey)).toBe(true);
    expect(first.readState().doc.toString()).toBe(base.markdown);
  });

  it('retains an uncertain rename lease and resumes only that exact target after settlement', async () => {
    const f = fixture(); const renameTarget = { ...target, destinationPath: '/vault/Renamed.md' };
    await expect(f.service.withAgentPublication(renameTarget, async lease => {
      lease.retainUntilSettled(); throw new Error('Uncertain rename');
    })).rejects.toThrow('Uncertain rename');
    await expect(f.service.withAgentPublication({ ...renameTarget, destinationPath: '/vault/Other.md' }, async () => {})).rejects.toThrow();
    expect(() => updateDocumentMarkdown(f.document, 'Stale-path edit')).toThrow();
    f.read.mockResolvedValue({ ...base, path: renameTarget.destinationPath, title: 'Renamed' });
    await expect(f.service.withAgentPublicationReconciliation(renameTarget, lease =>
      lease.adopt({ ...target, path: '/vault/Other.md', markdown: base.markdown })
    )).rejects.toThrow('differs');
    expect(await f.service.withAgentPublicationReconciliation(renameTarget, lease =>
      lease.adopt({ ...target, path: renameTarget.destinationPath, markdown: base.markdown })
    )).toBe('adopted');
    expect(getDocumentPath(f.document)).toBe(renameTarget.destinationPath);
    expect(f.service.isAgentPublicationActive()).toBe(false);
    expect(() => updateDocumentMarkdown(f.document, 'Current-path edit')).not.toThrow();
  });

  it('refuses an already queued old-path save before its effect, then reconciles the proven move', async () => {
    const f = fixture(); const renameTarget = { ...target, destinationPath: '/vault/Renamed.md' };
    updateDocumentMarkdown(f.document, 'Human draft'); f.root.restoreTransientMarkdown('Human draft');
    const first = Promise.withResolvers<void>();
    const active = f.runtime.requestSave(() => first.promise);
    const canonicalSave = vi.fn();
    const queued = f.runtime.requestSave(async () => {
      dispatchDocumentOperation(f.document, { type: 'start', operation: 'saving' });
      const capture = f.service.captureSave(f.document);
      canonicalSave(capture.path);
    });
    const refused = expect(queued).rejects.toThrow();
    const renamed = { ...base, path: renameTarget.destinationPath, title: 'Renamed' };
    f.read.mockResolvedValue(renamed);
    const adoption = f.service.withAgentPublicationReconciliation(renameTarget, lease =>
      lease.adopt({ ...target, path: renamed.path, markdown: base.markdown })
    );
    first.resolve(); await refused; await active.catch(() => {});
    expect(await adoption).toBe('conflict');
    expect(canonicalSave).not.toHaveBeenCalled();
    expect(getDocumentPath(f.document)).toBe(renamed.path);
    expect(f.document.working.body.toMarkdown()).toBe('Human draft');
  });

  it('retains a recovered rename lease when the captured document location changes before retry', async () => {
    const f = fixture(); const renameTarget = { ...target, destinationPath: '/vault/Renamed.md' };
    await f.service.withAgentPublicationReconciliation(renameTarget, async lease => { lease.retainUntilSettled(); });
    const capturedIdentity = f.document.identity;
    // Simulate canonical adoption completing from a save that started before the lease.
    f.document.identity = { kind: 'persisted', noteId: base.noteId, path: '/vault/Unexpected.md' };
    const effect = vi.fn();
    await expect(f.service.withAgentPublicationReconciliation(renameTarget, effect)).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
    expect(f.service.isAgentPublicationActive()).toBe(true);
    expect(() => f.service.captureSave(f.document)).toThrow();
    f.document.identity = capturedIdentity;
    f.read.mockResolvedValue({ ...base, path: renameTarget.destinationPath, title: 'Renamed' });
    await expect(f.service.withAgentPublicationReconciliation(renameTarget, lease =>
      lease.adopt({ ...target, path: renameTarget.destinationPath, markdown: base.markdown })
    )).resolves.toBe('adopted');
    expect(f.service.isAgentPublicationActive()).toBe(false);
  });
});
