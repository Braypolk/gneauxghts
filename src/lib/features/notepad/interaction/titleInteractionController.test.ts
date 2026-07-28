import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentState
} from '$lib/features/notepad/document/documentState';
import {
  createEmptySessionSnapshot
} from '$lib/features/notepad/session/session';
import { createTitleInteractionController } from './titleInteractionController';

const paneId = 'pane-1';

function setup(markdown = '') {
  const document = createDocumentState(
    {
      ...createEmptySessionSnapshot(),
      bodyMarkdown: markdown
    },
    'draft:title'
  );
  const activatePane = vi.fn();
  const resetPaneCommand = vi.fn();
  const updateTitle = vi.fn((target, title: string) => {
    target.working.title = title;
    return true;
  });
  const clearRecentlyForgotten = vi.fn();
  const scheduleAutosave = vi.fn();
  const flushPendingAutosave = vi.fn();
  const scheduleDerivedViews = vi.fn();
  const focusPaneEditorAtEnd = vi.fn(() => true);
  let paneCommandPaneId: string | null = paneId;
  const controller = createTitleInteractionController({
    activatePane,
    getPaneCommandPaneId: () => paneCommandPaneId,
    resetPaneCommand,
    getPaneDocument: () => document,
    updateTitle,
    clearRecentlyForgotten,
    scheduleAutosave,
    flushPendingAutosave,
    scheduleDerivedViews,
    focusPaneEditorAtEnd
  });
  return {
    controller,
    document,
    activatePane,
    resetPaneCommand,
    updateTitle,
    clearRecentlyForgotten,
    scheduleAutosave,
    flushPendingAutosave,
    scheduleDerivedViews,
    focusPaneEditorAtEnd,
    clearPaneCommand: () => {
      paneCommandPaneId = null;
    }
  };
}

describe('title interaction controller', () => {
  it('activates the pane and dismisses its pane command on input', () => {
    const harness = setup();

    harness.controller.handleFocus(paneId);
    harness.controller.handleInput(paneId);

    expect(harness.activatePane).toHaveBeenCalledTimes(2);
    expect(
      harness.resetPaneCommand
    ).toHaveBeenCalledOnce();

    harness.clearPaneCommand();
    harness.controller.handleInput(paneId);
    expect(
      harness.resetPaneCommand
    ).toHaveBeenCalledOnce();
  });

  it('formats and commits title changes through save and derived-view seams', () => {
    const harness = setup('body');

    harness.controller.handleBlur(paneId, '  My / Note  ');

    expect(harness.updateTitle).toHaveBeenCalledWith(
      harness.document,
      'My / Note'
    );
    expect(
      harness.clearRecentlyForgotten
    ).toHaveBeenCalledOnce();
    expect(harness.scheduleAutosave).toHaveBeenCalledWith(
      harness.document
    );
    expect(
      harness.scheduleDerivedViews
    ).toHaveBeenCalledOnce();
    expect(
      harness.flushPendingAutosave
    ).toHaveBeenCalledOnce();
  });

  it('moves Enter to the editor but leaves modified Enter untouched', () => {
    const harness = setup();
    const blur = vi.fn();
    const preventDefault = vi.fn();
    const enter = {
      key: 'Enter',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault,
      currentTarget: { blur }
    } as unknown as KeyboardEvent;

    harness.controller.handleKeydown(paneId, enter);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();
    expect(
      harness.focusPaneEditorAtEnd
    ).toHaveBeenCalledWith(paneId);

    harness.controller.handleKeydown(paneId, {
      ...enter,
      shiftKey: true
    });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
