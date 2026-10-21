export type Action = 'focus-search' | 'blur' | 'clear' | 'related' | 'search' | 'escape' | 'chat' | 'replace-chat' | 'previous' | 'split-chat' | 'split-note' | 'split-previous' | 'editor-pane' | 'chat-pane' | 'close-chat' | 'close-editor' | 'other-pane' | 'multiline' | 'empty-draft' | 'stop' | 'refresh';
export interface Scenario { id: string; group: string; label: string; layout: 'editor' | 'chat' | 'mixed' | 'editors' | 'chats'; start?: 'search' | 'related' | 'chat'; prepare?: Action[]; action: Action; note: string }
const entry = (id: string, group: string, label: string, layout: Scenario['layout'], action: Action, note: string, start?: Scenario['start'], prepare?: Action[]): Scenario => ({ id, group, label, layout, action, note, start, prepare });
export const scenarios: Scenario[] = [
  entry('search-focus', 'Search', 'Idle → focused Search', 'editor', 'focus-search', 'Bar expansion, controls, popup, bottom fade.'),
  entry('search-blur', 'Search', 'Focused → unfocused Search', 'editor', 'blur', 'Empty search collapses; a retained query keeps its expanded width.', 'search'),
  entry('search-refocus', 'Search', 'Retained query → focused Search', 'editor', 'focus-search', 'Select the populated / unfocused Search variant to inspect refocusing.'),
  entry('search-clear', 'Search', 'Clear retained query', 'editor', 'clear', 'Query, image preview and focus determine whether the bar collapses.', 'search'),
  entry('related-open', 'Related', 'Search → Related', 'editor', 'related', 'Local circle exchange, heading handoff, shared popup.'),
  entry('related-expanded', 'Related', 'Expanded Search → Related', 'editor', 'related', 'Outgoing search wrapping persists through the fade.', 'search'),
  entry('related-search', 'Related', 'Related → Search circle', 'editor', 'search', 'Restore retained query and scope; focus the Search input.', 'related'),
  entry('related-escape', 'Related', 'Dismiss Related with Escape', 'editor', 'escape', 'Restore the appropriate Search presentation and editor focus.', 'related'),
  entry('related-toggle', 'Related', 'Dismiss Related by toggle', 'editor', 'related', 'Inspect popup collapse and bar return.', 'related'),
  entry('related-outside', 'Related', 'Dismiss Related by outside focus', 'editor', 'blur', 'Outside focus and Escape can have different focus destinations.', 'related'),
  entry('related-refresh', 'Related', 'Refresh Related results', 'editor', 'refresh', 'Keep rows and popup geometry while retrieval refreshes.', 'related'),
  entry('related-mixed', 'Related', 'Search → Related with chat retained', 'mixed', 'related', 'Include the chat return circle; active owner remains the note.'),
  entry('local-to-search', 'Chat exchange', 'Chat input → Search', 'chat', 'search', 'Same chat stays mounted; compress composer, exchange circles, reveal Search.', 'chat'),
  entry('local-to-chat', 'Chat exchange', 'Search → retained Chat input', 'chat', 'chat', 'Stable pane membership and shared dock width.', 'search'),
  entry('related-to-chat', 'Chat exchange', 'Related → retained Chat', 'mixed', 'chat', 'Dismiss Related without flashing Search contents.', 'related'),
  entry('composer-grow', 'Chat exchange', 'Composer → multiline draft', 'chat', 'multiline', 'Measured height grows upward; bottom fade and reading clearance follow.', 'chat'),
  entry('composer-empty', 'Chat exchange', 'Multiline → empty draft', 'chat', 'empty-draft', 'Measured height shrinks and Send becomes disabled.', 'chat', ['multiline']),
  entry('composer-stop', 'Chat exchange', 'Running generation → Stop', 'chat', 'stop', 'Choose the running composer variant; inspect Stop → Send geometry.', 'chat'),
  entry('replace-chat', 'Editor → Chat', 'Replace editor with Chat', 'editor', 'replace-chat', 'Pane identity stays; dock target and content owner change.'),
  entry('related-replace', 'Editor → Chat', 'Related → replace editor with Chat', 'editor', 'replace-chat', 'Departure from an open Related popup.', 'related'),
  entry('split-chat', 'Editor → Chat', 'Open Chat beside editor', 'editor', 'split-chat', 'Pane reveal, card bounds and dock handoff share the transition.'),
  entry('split-current-chat', 'Editor → Chat', 'Split with current Chat location', 'chat', 'split-note', 'Retain the selected conversation while opening its current location beside it.', 'chat'),
  entry('split-previous-chat', 'Editor → Chat', 'Split with previous Chat location', 'chat', 'split-previous', 'Return to the editor, then adopt its retained previous chat directly.', 'chat', ['previous']),
  entry('related-split', 'Editor → Chat', 'Related → open Chat beside editor', 'editor', 'split-chat', 'Popup departure while entering a split.', 'related'),
  entry('activate-chat', 'Editor → Chat', 'Activate retained Chat pane', 'mixed', 'chat-pane', 'Wide split or collapsed rail, depending on preview width.'),
  entry('return-editor', 'Chat → Editor', 'Replace only Chat with editor', 'chat', 'previous', 'Last chat disappears; ordinary Search sizing returns.', 'chat'),
  entry('activate-editor', 'Chat → Editor', 'Activate retained editor pane', 'mixed', 'editor-pane', 'Chat remains mounted; shared Search and Chat dock persists.', 'chat'),
  entry('close-last-chat', 'Chat → Editor', 'Close last Chat pane', 'mixed', 'close-chat', 'Chat circle leaves; card and ordinary Search constraints change.', 'chat'),
  entry('close-inactive-chat', 'Chat → Editor', 'Close inactive Chat pane', 'mixed', 'close-chat', 'Different visible origin from closing the active pane.'),
  entry('replace-one-chat', 'Chat → Editor', 'Replace one Chat; another remains', 'chats', 'previous', 'Inspect the destination and retained chat return owner.', 'chat'),
  entry('close-one-chat', 'Chat → Editor', 'Close Chat; another remains', 'chats', 'close-chat', 'Surviving composer retains its own draft.', 'chat'),
  entry('two-editors-open', 'Pane ownership', 'Open second editor', 'editor', 'split-note', 'Enter a split without adding chat availability.'),
  entry('two-editors-switch', 'Pane ownership', 'Switch editor owners', 'editors', 'other-pane', 'Search may stay Search while note context changes.'),
  entry('related-owner', 'Pane ownership', 'Related → other editor', 'editors', 'other-pane', 'Related dismisses on owner changes.', 'related'),
  entry('two-chats-switch', 'Pane ownership', 'Switch Chat owners', 'chats', 'other-pane', 'Both composers keep their own draft and height.', 'chat'),
  entry('close-editor', 'Pane ownership', 'Close editor; retain Chat', 'mixed', 'close-editor', 'Pane layout changes and surviving Chat becomes active.'),
];
export interface Options { search: string; composer: string; related: string; condition: string; interruptAt: number; duration: number; fontSize: number; keyboardInset: number; safeArea: number }
export const defaults: Options = { search: 'idle', composer: 'empty', related: 'ready', condition: 'normal', interruptAt: 160, duration: 1200, fontSize: 16, keyboardInset: 0, safeArea: 0 };

// A reverse must return to this case's origin. Destructive pane operations and
// content changes need their own restoration path before they can offer one.
export const reverseActions: Partial<Record<string, Action>> = {
  'search-focus': 'blur', 'search-blur': 'focus-search', 'search-refocus': 'blur',
  'related-open': 'search', 'related-expanded': 'search', 'related-mixed': 'search',
  'related-search': 'related', 'related-escape': 'related', 'related-toggle': 'related', 'related-outside': 'related',
  'local-to-search': 'chat', 'local-to-chat': 'search',
  'activate-chat': 'editor-pane', 'activate-editor': 'chat-pane',
  'two-editors-switch': 'other-pane', 'two-chats-switch': 'other-pane',
};
