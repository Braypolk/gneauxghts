import { describe, expect, it, vi } from 'vitest';
import {
  adoptChatContextFromLeavingEditor,
  getChatContextPaneId,
  getNavigationPaneId,
  getNearestEditorPaneId
} from './paneRoles';
import type { PaneKind } from './paneTypes';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';

type PaneId = 'left' | 'middle' | 'right';

function kinds(
  value: Record<PaneId, PaneKind>
): (paneId: PaneId) => PaneKind {
  return (paneId) => value[paneId];
}

describe('paneRoles', () => {
  it('keeps the active editor as the generic navigation target', () => {
    const getPaneKind = kinds({
      left: 'editor',
      middle: 'chat',
      right: 'editor'
    });

    expect(
      getNavigationPaneId({
        paneOrder: ['left', 'middle', 'right'],
        activePaneId: 'right',
        getPaneKind
      })
    ).toBe('right');
  });

  it('selects the nearest editor for generic navigation', () => {
    const getPaneKind = kinds({
      left: 'editor',
      middle: 'chat',
      right: 'editor'
    });

    expect(
      getNearestEditorPaneId(
        ['middle', 'right', 'left'],
        getPaneKind,
        'middle'
      )
    ).toBe('right');
    expect(
      getNavigationPaneId({
        paneOrder: ['left', 'middle', 'right'],
        activePaneId: 'middle',
        getPaneKind
      })
    ).toBe('left');
  });

  it('draws chat context from the nearest editor pane', () => {
    const getPaneKind = kinds({
      left: 'editor',
      middle: 'chat',
      right: 'editor'
    });

    expect(
      getChatContextPaneId(
        ['middle', 'right', 'left'],
        getPaneKind,
        'middle'
      )
    ).toBe('right');
  });

  it('falls back to the chat pane retained note when no editor is visible', () => {
    const getPaneKind = kinds({
      left: 'chat',
      middle: 'chat',
      right: 'chat'
    });

    expect(
      getChatContextPaneId(
        ['left', 'middle', 'right'],
        getPaneKind,
        'middle'
      )
    ).toBe('middle');
  });

  it('copies a leaving editor note onto chat panes that were following it', () => {
    const getPaneKind = kinds({
      left: 'editor',
      middle: 'chat',
      right: 'editor'
    });
    const leaving = createNoteDraftState({
      ...createEmptySessionSnapshot(),
      currentNoteId: 'note-recent',
      currentNotePath: 'Notes/Recent.md',
      title: 'Recent'
    });
    const setPaneDocument = vi.fn();

    adoptChatContextFromLeavingEditor(
      ['left', 'middle', 'right'],
      getPaneKind,
      'left',
      leaving,
      setPaneDocument
    );

    expect(setPaneDocument).toHaveBeenCalledOnce();
    expect(setPaneDocument).toHaveBeenCalledWith('middle', leaving);
  });

  it('does not rewrite chat context when a non-context editor leaves', () => {
    const getPaneKind = kinds({
      left: 'editor',
      middle: 'chat',
      right: 'editor'
    });
    const setPaneDocument = vi.fn();

    adoptChatContextFromLeavingEditor(
      ['left', 'middle', 'right'],
      getPaneKind,
      'right',
      createNoteDraftState(createEmptySessionSnapshot()),
      setPaneDocument
    );

    // middle's nearest editor is left, so closing right is irrelevant.
    expect(setPaneDocument).not.toHaveBeenCalled();
  });
});
