import { describe, expect, it, vi } from 'vitest';
import { createPaneCommandGroup } from './paneCommandGroup';

describe('createPaneCommandGroup', () => {
  it('activates a pane and refreshes derived views through the grouped seam', () => {
    const document = { id: 'doc' };
    const flushDocumentEditorSync = vi.fn();
    const activatePaneSession = vi.fn();
    const updateSelectedRelatedText = vi.fn();
    const scheduleSearchIfNeeded = vi.fn();
    const scheduleRelatedIfNeeded = vi.fn();
    const group = createPaneCommandGroup({
      getPaneTitleInput: () => null,
      getPaneEditorRoot: () => null,
      getPaneChatComposer: () => null,
      getPaneDocument: () => document,
      flushDocumentEditorSync,
      activatePaneSession,
      updateSelectedRelatedText,
      scheduleSearchIfNeeded,
      scheduleRelatedIfNeeded
    });

    group.activatePane('primary');

    expect(flushDocumentEditorSync).toHaveBeenCalledWith(document);
    expect(activatePaneSession).toHaveBeenCalledWith('primary');
    expect(updateSelectedRelatedText).toHaveBeenCalledWith('primary');
    expect(scheduleSearchIfNeeded).toHaveBeenCalledTimes(1);
    expect(scheduleRelatedIfNeeded).toHaveBeenCalledWith({ immediate: true });
  });

  it('focuses the chat composer when switching into a chat pane', () => {
    const chatComposer = {
      focus: vi.fn()
    } as unknown as HTMLTextAreaElement;
    const group = createPaneCommandGroup({
      getPaneTitleInput: () => null,
      getPaneEditorRoot: () => null,
      getPaneChatComposer: () => chatComposer,
      getPaneDocument: () => ({ id: 'doc' }),
      flushDocumentEditorSync: vi.fn(),
      activatePaneSession: vi.fn(),
      updateSelectedRelatedText: vi.fn(),
      scheduleSearchIfNeeded: vi.fn(),
      scheduleRelatedIfNeeded: vi.fn()
    });

    group.focusPaneAfterShortcut('chat-pane');

    expect(chatComposer.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
