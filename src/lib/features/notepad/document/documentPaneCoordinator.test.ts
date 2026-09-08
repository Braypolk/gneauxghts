import { describe, expect, it, vi } from 'vitest';
import { createDocumentPaneCoordinator } from './documentPaneCoordinator';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

function note(_label: string, bodyMarkdown: string) {
  return createNoteDraftState(
    {
      ...createEmptySessionSnapshot(),
      bodyMarkdown
    }
  );
}

describe('documentPaneCoordinator', () => {
  it('flushes only a pending cursor snapshot during pane teardown', () => {
    const document = note('document:shared', 'body');
    const position = { anchor: 4, head: 4, scrollTop: 720 };
    const saveCursorPosition = vi.fn(async () => 'applied');
    let pending: (() => void) | null = null;
    const runtime = {
      scheduleCursorSave: (callback: () => void) => {
        pending = callback;
      },
      flushCursorSave: (fallback?: () => void) => {
        const callback = pending ?? fallback ?? null;
        pending = null;
        callback?.();
      }
    };
    const coordinator = createDocumentPaneCoordinator({
      paneLifecycle: {
        captureViewState: () => position,
        saveCursorPosition
      } as never,
      getPaneRuntime: () => runtime as never,
      getVisiblePaneIds: () => ['left'],
      getPaneIdsForDocument: () => ['left'],
      getPaneKind: () => 'editor',
      getNavigationDocument: () => document,
      getNavigationPaneId: () => 'left',
      getPaneDocument: () => document,
      getDocumentByHandle: () => document
    });

    coordinator.schedulePaneCursorSave('left');
    coordinator.flushPaneCursorSave('left');
    coordinator.flushPaneCursorSave('left');

    expect(saveCursorPosition).toHaveBeenCalledOnce();
    expect(saveCursorPosition).toHaveBeenCalledWith(
      'left',
      document,
      position
    );
  });

  it('uses one pane-session replacement for same-document runtime fanout', async () => {
    const document = note('document:shared', 'updated');
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
      getDocumentByHandle: () => document
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
    const previous = note('document:old', 'old');
    const next = note('document:new', 'new');
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
      getDocumentByHandle: () => previous
    });

    await coordinator.replaceNoteAcrossPanes(previous, next, {
      restoreCursor: true
    });

    expect(bindDocument.mock.calls).toEqual([
      ['left', next, { restoreCursor: true }],
      ['right', next, { restoreCursor: true }]
    ]);
  });

  it('rebinds only the navigating pane when another pane already shows the destination', async () => {
    const previous = note('document:old', 'old');
    const next = note('document:shared', 'shared');
    const bindDocument = vi.fn(async () => 'applied');
    const coordinator = createDocumentPaneCoordinator({
      paneLifecycle: { bindDocument } as never,
      getPaneRuntime: () => ({}) as never,
      getVisiblePaneIds: () => ['left', 'right'],
      getPaneIdsForDocument: () => ['left', 'right'],
      getPaneKind: () => 'editor',
      getNavigationDocument: () => next,
      getNavigationPaneId: () => 'right',
      getPaneDocument: () => next,
      getDocumentByHandle: () => next
    });

    await coordinator.replacePaneDocument(
      'right',
      previous,
      next,
      { restoreCursor: true }
    );

    expect(bindDocument).toHaveBeenCalledOnce();
    expect(bindDocument).toHaveBeenCalledWith(
      'right',
      next,
      { restoreCursor: true }
    );
  });

  it('replaces a specifically targeted open document instead of the navigation document', async () => {
    const navigation = note('document:current', 'current');
    const target = note('document:tasks', 'updated tasks');
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
      getDocumentByHandle: () => target
    });

    await coordinator.replaceDocumentContentInPlace(
      target,
      target.working.markdown
    );

    expect(replaceContentInPlace).toHaveBeenCalledWith(
      'right',
      'updated tasks',
      target,
      true,
      {}
    );
  });

  it('reports unavailable when no editable pane can apply a targeted replacement', async () => {
    const document = note('document:shared', 'updated');
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
      getDocumentByHandle: () => document
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
