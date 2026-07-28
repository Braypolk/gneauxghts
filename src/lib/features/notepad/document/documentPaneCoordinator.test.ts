import { describe, expect, it, vi } from 'vitest';
import { createDocumentPaneCoordinator } from './documentPaneCoordinator';
import {
  createNoteDraftState,
  type NoteKey
} from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

function note(key: NoteKey, bodyMarkdown: string) {
  return createNoteDraftState(
    {
      ...createEmptySessionSnapshot(),
      bodyMarkdown
    },
    key
  );
}

describe('documentPaneCoordinator', () => {
  it('uses one pane-session replacement for same-document runtime fanout', async () => {
    const document = note('path:/vault/shared.md', 'updated');
    const replaceContentInPlace = vi.fn(async () => 'applied');
    const coordinator = createDocumentPaneCoordinator({
      paneLifecycle: {
        replaceContentInPlace
      } as never,
      getPaneRuntime: () => ({}) as never,
      getVisiblePaneIds: () => ['left', 'right'],
      getPaneIdsForDocument: () => ['left', 'right'],
      getPaneKind: () => 'editor',
      getNavigationDocument: () => document,
      getNavigationPaneId: () => 'right',
      getPaneDocument: () => document,
      getNoteByKey: () => document
    });

    await coordinator.replaceNoteAcrossPanes(
      document,
      document
    );

    expect(replaceContentInPlace).toHaveBeenCalledOnce();
    expect(replaceContentInPlace).toHaveBeenCalledWith(
      'right',
      'updated',
      document,
      true
    );
  });

  it('serializes every different-document rebind through its pane session', async () => {
    const previous = note('path:/vault/old.md', 'old');
    const next = note('path:/vault/new.md', 'new');
    const bindDocument = vi.fn(async () => 'applied');
    const coordinator = createDocumentPaneCoordinator({
      paneLifecycle: { bindDocument } as never,
      getPaneRuntime: () => ({}) as never,
      getVisiblePaneIds: () => ['left', 'right'],
      getPaneIdsForDocument: () => ['left', 'right'],
      getPaneKind: () => 'editor',
      getNavigationDocument: () => next,
      getNavigationPaneId: () => 'left',
      getPaneDocument: () => next,
      getNoteByKey: () => previous
    });

    await coordinator.replaceNoteAcrossPanes(previous, next, {
      restoreCursor: true
    });

    expect(bindDocument.mock.calls).toEqual([
      ['left', next, { restoreCursor: true }],
      ['right', next, { restoreCursor: true }]
    ]);
  });

  it('replaces a specifically targeted open document instead of the navigation document', async () => {
    const navigation = note('path:/vault/current.md', 'current');
    const target = note('path:/vault/tasks.md', 'updated tasks');
    const replaceContentInPlace = vi.fn(async () => 'applied');
    const coordinator = createDocumentPaneCoordinator({
      paneLifecycle: { replaceContentInPlace } as never,
      getPaneRuntime: () => ({}) as never,
      getVisiblePaneIds: () => ['left', 'right'],
      getPaneIdsForDocument: (document) =>
        document === target ? ['right'] : ['left'],
      getPaneKind: () => 'editor',
      getNavigationDocument: () => navigation,
      getNavigationPaneId: () => 'left',
      getPaneDocument: (paneId) =>
        paneId === 'right' ? target : navigation,
      getNoteByKey: () => target
    });

    await coordinator.replaceDocumentContentInPlace(
      target,
      target.working.markdown
    );

    expect(replaceContentInPlace).toHaveBeenCalledWith(
      'right',
      'updated tasks',
      target,
      true
    );
  });

  it('reports unavailable when no editable pane can apply a targeted replacement', async () => {
    const document = note('path:/vault/shared.md', 'updated');
    const replaceContentInPlace = vi.fn();
    const coordinator = createDocumentPaneCoordinator({
      paneLifecycle: {
        replaceContentInPlace
      } as never,
      getPaneRuntime: () => ({}) as never,
      getVisiblePaneIds: () => ['left'],
      getPaneIdsForDocument: () => ['left'],
      getPaneKind: () => 'chat',
      getNavigationDocument: () => document,
      getNavigationPaneId: () => 'left',
      getPaneDocument: () => document,
      getNoteByKey: () => document
    });

    await expect(
      coordinator.replaceDocumentContentInPlace(
        document,
        'from disk'
      )
    ).resolves.toBe('unavailable');
    expect(replaceContentInPlace).not.toHaveBeenCalled();
  });
});
