import { describe, expect, it, vi } from 'vitest';
import {
  createPaneSessionController,
  findPaneCommandPreviousItem,
  paneCommandNoteLabel,
  paneCommandPreviousNoteLabel
} from './paneSessionController';
import { createNoteDraftState, type NoteDraftState } from '$lib/features/notepad/state/noteStore';
import type { SearchItem } from '$lib/types/semantic';

function searchItem(overrides: Partial<SearchItem>): SearchItem {
  return {
    noteId: null,
    notePath: null,
    fileName: '',
    sectionLabel: '',
    excerpt: '',
    highlightRanges: [],
    matchText: '',
    reasonLabels: [],
    lexicalScore: null,
    semanticScore: null,
    startLine: null,
    endLine: null,
    ...overrides
  };
}

describe('paneSessionController', () => {
  it('chooses editor panes for navigation and cycles split panes', () => {
    const documents: Record<string, NoteDraftState> = {
      primary: createNoteDraftState(),
      secondary: createNoteDraftState()
    };
    const kinds = { primary: 'chat', secondary: 'editor' } as const;
    const activatePaneSession = vi.fn();

    const controller = createPaneSessionController({
      getPaneOrder: () => ['primary', 'secondary'],
      getActivePaneId: () => 'primary',
      getPaneKind: (paneId: 'primary' | 'secondary') => kinds[paneId],
      getPaneDocumentSession: (paneId: 'primary' | 'secondary') => documents[paneId],
      activatePaneSession,
      setPaneDocumentSession: vi.fn()
    });

    expect(controller.getEditorPaneIds()).toEqual(['secondary']);
    expect(controller.getNavigationPaneId()).toBe('secondary');
    expect(controller.getNextPaneId('secondary')).toBe('primary');

    controller.activatePane('secondary');
    expect(activatePaneSession).toHaveBeenCalledWith('secondary');
  });

  it('keeps pane command previous-note choices off the source note', () => {
    const source = createNoteDraftState({
      title: '',
      bodyMarkdown: '',
      currentNoteId: 'source-id',
      currentNotePath: '/vault/Source.md',
      lastSavedTitle: '',
      lastSavedMarkdown: '',
      lastSavedNoteId: 'source-id',
      lastSavedPath: '/vault/Source.md'
    });

    const previous = findPaneCommandPreviousItem(
      [
        searchItem({ noteId: 'source-id', notePath: '/vault/Source.md', fileName: 'Source' }),
        searchItem({ noteId: 'other-id', notePath: '/vault/Other.md', fileName: 'Other' })
      ],
      source
    );

    expect(previous?.notePath).toBe('/vault/Other.md');
    expect(paneCommandNoteLabel(source)).toBe('Source');
    expect(paneCommandPreviousNoteLabel(previous)).toBe('Other');
  });
});
