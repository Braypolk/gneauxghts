import { describe, expect, it, vi } from 'vitest';
import { createPaneCommandGroup } from './paneCommandGroup';

describe('createPaneCommandGroup', () => {
  it('activates a pane and refreshes derived views through the grouped seam', () => {
    const activatePaneSession = vi.fn();
    const updateSelectedRelatedText = vi.fn();
    const scheduleSearchIfNeeded = vi.fn();
    const scheduleRelatedIfNeeded = vi.fn();
    const group = createPaneCommandGroup({
      getPaneTitleInput: () => null,
      focusPaneEditor: () => false,
      focusPaneChat: () => false,
      activatePaneSession,
      updateSelectedRelatedText,
      scheduleSearchIfNeeded,
      scheduleRelatedIfNeeded
    });

    group.activatePane('primary');

    expect(activatePaneSession).toHaveBeenCalledWith('primary');
    expect(updateSelectedRelatedText).toHaveBeenCalledWith('primary');
    expect(scheduleSearchIfNeeded).toHaveBeenCalledTimes(1);
    expect(scheduleRelatedIfNeeded).toHaveBeenCalledWith({ immediate: true });
  });

  it('focuses the chat composer when switching into a chat pane', () => {
    const focusPaneChat = vi.fn(() => true);
    const group = createPaneCommandGroup({
      getPaneTitleInput: () => null,
      focusPaneEditor: () => false,
      focusPaneChat,
      activatePaneSession: vi.fn(),
      updateSelectedRelatedText: vi.fn(),
      scheduleSearchIfNeeded: vi.fn(),
      scheduleRelatedIfNeeded: vi.fn()
    });

    group.focusPaneAfterShortcut('chat-pane');

    expect(focusPaneChat).toHaveBeenCalledWith('chat-pane');
  });
});
