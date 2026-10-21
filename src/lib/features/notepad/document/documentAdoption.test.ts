import { DocumentBody } from '#lib/features/notepad/document/documentBody.js';
import { describe, expect, it } from 'vitest';
import { createNoteDraftState } from '../state/noteStore';
import { createEmptySessionSnapshot } from '../session/session';
import { applyCommittedNoteToDocument, applySessionSnapshotToDocument, updateDocumentMarkdown, updateDocumentTitle, updateDocumentTags } from './documentState';
import type { NoteSession } from '../model/types';

const initial = {
  ...createEmptySessionSnapshot(), title: 'Before', bodyMarkdown: 'body', tags: ['old'],
  currentNoteId: 'note', currentNotePath: '/vault/note.md', lastSavedTitle: 'Before',
  lastSavedMarkdown: 'body', lastSavedTags: ['old'], lastSavedNoteId: 'note', lastSavedPath: '/vault/note.md'
};
const next: NoteSession = { noteId: 'note', path: '/vault/note.md', title: 'After', markdown: 'new body', tags: ['new'] };
const adapters = {
  committed: applyCommittedNoteToDocument,
  session: (document: Parameters<typeof applyCommittedNoteToDocument>[0], value: NoteSession, options?: Parameters<typeof applyCommittedNoteToDocument>[2]) => applySessionSnapshotToDocument(document, {
    title: value.title, bodyMarkdown: value.markdown, currentNoteId: value.noteId, currentNotePath: value.path,
    lastSavedTitle: value.title, lastSavedMarkdown: value.markdown, lastSavedNoteId: value.noteId, lastSavedPath: value.path,
    tags: value.tags, lastSavedTags: value.tags, tagsError: value.tagsError, commitWarning: value.commitWarning
  }, options)
};
for (const [name, adopt] of Object.entries(adapters)) describe(`${name} snapshot adoption`, () => {
  it('adopts authored fields in one revision and copies the tag array', () => {
    const document = createNoteDraftState(initial);
    const revision = document.operation.revision;
    expect(adopt(document, next)).toEqual({ titleChanged: true, markdownChanged: true });
    expect(document.working).toMatchObject({ title: 'After', body: DocumentBody.fromMarkdown('new body'), tags: ['new'] });
    expect(document.operation.revision).toBe(revision + 1);
    expect(document.working.tags).not.toBe(next.tags);
  });
  it.each([true, false])('preserves dirty title/body and selects tag preservation=%s', (preserveTags) => {
    const document = createNoteDraftState(initial);
    updateDocumentMarkdown(document, 'later body'); updateDocumentTitle(document, 'Later'); updateDocumentTags(document, ['local']);
    const revision = document.operation.revision;
    expect(adopt(document, next, { preserveWorking: true, preserveTags })).toEqual({ titleChanged: false, markdownChanged: false });
    expect(document.working).toMatchObject({ title: 'Later', body: DocumentBody.fromMarkdown('later body'), tags: preserveTags ? ['local'] : ['new'] });
    expect(document.savedBaseline?.content).toMatchObject({ title: 'After', body: DocumentBody.fromMarkdown('new body'), tags: ['new'] });
    expect(document.operation.revision).toBe(revision + (preserveTags ? 0 : 1));
  });
  it('preserves dirty tags by default while adopting a clean tags diagnostic', () => {
    const document = createNoteDraftState(initial);
    updateDocumentTags(document, ['local']);
    adopt(document, next, { preserveWorking: true });
    expect(document.working.tags).toEqual(['local']);
    const clean = createNoteDraftState(initial);
    const revision = clean.operation.revision;
    adopt(clean, { ...next, title: 'Before', markdown: 'body', tags: ['old'], tagsError: 'invalid tags' });
    expect(clean.working.tagsError).toBe('invalid tags');
    expect(clean.operation.revision).toBe(revision);
  });
  it('removes tags and adopts identity/warning without manufacturing body changes', () => {
    const document = createNoteDraftState(initial);
    const warning = { message: 'pending', issues: [{ stage: 'historyFinalization' as const, message: 'retry' }] };
    expect(adopt(document, { ...next, title: 'Before', markdown: 'body', path: '/vault/renamed.md', tags: [], commitWarning: warning })).toEqual({ titleChanged: false, markdownChanged: false });
    expect(document.working.tags).toEqual([]);
    expect(document.identity).toMatchObject({ path: '/vault/renamed.md' });
    expect(document.publication.warning).toEqual(warning);
    const revision = document.operation.revision;
    adopt(document, { ...next, title: 'Before', markdown: 'body', tags: [], path: '/vault/other.md' });
    expect(document.operation.revision).toBe(revision);
    expect(document.publication.warning).toBeNull();
  });
});
