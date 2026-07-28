import { describe, expect, it } from 'vitest';
import {
  getNavigationPaneId,
  getNearestEditorPaneId,
  getRetainedPaneContext
} from './paneRoles';
import type { PaneKind } from './paneTypes';

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

  it('uses a chat pane explicit retained note as its context', () => {
    const retainedNotes = {
      left: 'left-note',
      middle: 'chat-context-note',
      right: 'right-note'
    } as const;

    expect(
      getRetainedPaneContext(
        'middle' as PaneId,
        (paneId) => retainedNotes[paneId]
      )
    ).toBe('chat-context-note');
  });
});
