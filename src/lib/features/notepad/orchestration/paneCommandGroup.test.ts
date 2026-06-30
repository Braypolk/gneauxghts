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
      getSplitPickerPaneId: () => null,
      getSplitPickerFocusEl: () => null,
      getPaneTitleInput: () => null,
      getPaneEditorRoot: () => null,
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
});
