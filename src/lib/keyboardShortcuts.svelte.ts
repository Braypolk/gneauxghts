import { logDevError } from '#lib/logDevError.js';
import { restartLifecycle } from '#lib/app/restartLifecycle.svelte.js';

type ModifierToken = 'Meta' | 'Ctrl' | 'Alt' | 'Shift';
type ShortcutGroupId = 'navigation' | 'workspace' | 'search' | 'editor' | 'chat' | 'history' | 'images' | 'map';

export type KeyboardShortcutId =
  | 'navNote'
  | 'navList'
  | 'navAtlas'
  | 'navSettings'
  | 'openThoughtPartner'
  | 'showHistory'
  | 'openSplitPaneOptions'
  | 'showSplitOptions'
  | 'openNewChatInSplit'
  | 'openPreviousNoteInSplit'
  | 'closePane'
  | 'switchPane'
  | 'goToPreviousNote'
  | 'toggleRelatedPanel'
  | 'togglePinCurrentNote'
  | 'rememberCurrentNote'
  | 'forgetCurrentNote'
  | 'searchCurrent'
  | 'searchAll'
  | 'recentNote1'
  | 'recentNote2'
  | 'recentNote3'
  | 'recentNote4'
  | 'recentNote5'
  | 'recentNote6'
  | 'recentNote7'
  | 'recentNote8'
  | 'recentNote9'
  | 'editorUndo'
  | 'editorRedo'
  | 'editorInsertBelow'
  | 'editorMoveLineUp'
  | 'editorMoveLineDown'
  | 'editorCutLine'
  | 'editorHardBreak'
  | 'editorSplitLine'
  | 'editorDeleteToLineEnd'
  | 'editorStructuralIndent'
  | 'editorStructuralOutdent'
  | 'editorBold'
  | 'editorItalic'
  | 'editorLink'
  | 'searchOpenInSplit'
  | 'editorOpenWikilink'
  | 'chatSend'
  | 'historyExit'
  | 'historyRename'
  | 'paneChoice1'
  | 'paneChoice2'
  | 'paneChoice3'
  | 'imageViewerClose'
  | 'imageViewerNext'
  | 'imageViewerPrevious'
  | 'imageViewerZoomIn'
  | 'imageViewerZoomOut'
  | 'imageViewerReset'
  | 'imageOpen'
  | 'imageSource'
  | 'imageWidth'
  | 'imageGrow'
  | 'imageShrink'
  | 'imageReset'
  | 'imageDelete'
  | 'imageCopySource'
  | 'imageCutSource'
  | 'mapOpen'
  | 'mapPreview'
  | 'mapDismiss'
  | 'mapNext'
  | 'mapPrevious'
  | 'mapZoomIn'
  | 'mapZoomOut'
  | 'mapReset'
  | 'editorCopyLineUp'
  | 'editorCopyLineDown'
  | 'editorAddCursorAbove'
  | 'editorAddCursorBelow'
  | 'editorSelectLine'
  | 'editorIndentLess'
  | 'editorIndentMore'
  | 'editorIndentSelection'
  | 'editorDeleteLine'
  | 'editorMatchingBracket'
  | 'editorToggleComment'
  | 'editorToggleBlockComment'
  | 'editorToggleTabFocus'
  | 'editorSimplifySelection';

export interface KeyboardShortcutDefinition {
  id: KeyboardShortcutId;
  label: string;
  description: string;
  group: ShortcutGroupId;
  defaultBinding: string;
  additionalBindings?: readonly string[];
  nonMacBindings?: readonly string[];
  activation?: 'holdModifiers';
}

export interface KeyboardShortcutGroup {
  id: ShortcutGroupId;
  label: string;
  description: string;
}

export type KeyboardShortcutBindings = Record<KeyboardShortcutId, string[]>;

interface ParsedShortcutBinding {
  /** Empty for a modifier-only hold. */
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const KEYBOARD_SHORTCUTS_STORAGE_KEY = 'gneauxghts.keyboard-shortcuts';
const MODIFIER_ORDER: ModifierToken[] = ['Meta', 'Ctrl', 'Alt', 'Shift'];
const NAMED_KEY_TOKENS = new Set([
  'Tab',
  'Enter',
  'Escape',
  'Backspace',
  'Delete',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'ContextMenu'
]);
const MODIFIER_ONLY_CODES = new Set(['MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight']);

export const keyboardShortcutGroups = [
  {
    id: 'navigation',
    label: 'Navigation',
    description: 'Move around app sections.'
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Pane layout and note actions.'
  },
  {
    id: 'search',
    label: 'Search & Recents',
    description: 'Search focus and recent-item jumps.'
  },
  {
    id: 'editor',
    label: 'Editor',
    description: 'Editing commands inside note body.'
  },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Chat composer commands.',
  },
  {
    id: 'history',
    label: 'History',
    description: 'Browse and name Note Revisions.',
  },
  {
    id: 'images',
    label: 'Image Viewer',
    description: 'Browse and zoom images.',
  },
  { id: 'map', label: 'Map', description: 'Browse notes and adjust the map.' }
] as const satisfies readonly KeyboardShortcutGroup[];

const shortcutDefinitionsBase = [
  {
    id: 'navNote',
    label: 'Go to Note',
    description: 'Open note view.',
    group: 'navigation',
    defaultBinding: 'Meta+2'
  },
  {
    id: 'navList',
    label: 'Go to List',
    description: 'Open list view.',
    group: 'navigation',
    defaultBinding: 'Meta+3'
  },
  {
    id: 'navAtlas',
    label: 'Go to Map',
    description: 'Open vault map.',
    group: 'navigation',
    defaultBinding: 'Meta+1'
  },
  {
    id: 'navSettings',
    label: 'Open Settings',
    description: 'Open settings screen.',
    group: 'navigation',
    defaultBinding: 'Meta+,'
  },
  {
    id: 'openThoughtPartner',
    label: 'Open Thought Partner',
    description: 'Open the thought partner in the current pane.',
    group: 'workspace',
    defaultBinding: 'Meta+t'
  },
  {
    id: 'showHistory',
    label: 'Show History',
    description: 'Show history for the note in the active editor pane.',
    group: 'workspace',
    defaultBinding: 'Meta+Shift+h'
  },
  {
    id: 'openSplitPaneOptions',
    label: 'Open Split Pane Options',
    description: 'Open a new split pane and choose its contents.',
    group: 'workspace',
    defaultBinding: 'Meta+Shift+n'
  },
  {
    id: 'showSplitOptions',
    label: 'Show Split Options',
    description: 'Hold the assigned modifiers to reveal the editor’s split pane controls.',
    group: 'workspace',
    defaultBinding: 'Alt',
    additionalBindings: ['Meta+Shift'],
    activation: 'holdModifiers'
  },
  {
    id: 'openNewChatInSplit',
    label: 'Open New Chat in Split',
    description: 'Open a new thought partner chat in a split pane.',
    group: 'workspace',
    defaultBinding: 'Meta+Shift+t'
  },
  {
    id: 'openPreviousNoteInSplit',
    label: 'Open Previous Note in Split',
    description: 'Open the previous note or chat location in a split pane.',
    group: 'workspace',
    defaultBinding: 'Meta+Shift+l'
  },
  {
    id: 'closePane',
    label: 'Close Active Pane',
    description: 'Close current split pane.',
    group: 'workspace',
    defaultBinding: 'Meta+w'
  },
  {
    id: 'switchPane',
    label: 'Switch Active Pane',
    description: 'Move focus to other pane.',
    group: 'workspace',
    defaultBinding: 'Ctrl+Tab'
  },
  {
    id: 'goToPreviousNote',
    label: 'Go to Previous Note',
    description: 'Open the previous note or chat location in the current pane.',
    group: 'workspace',
    defaultBinding: 'Meta+l'
  },
  {
    id: 'toggleRelatedPanel',
    label: 'Related Notes',
    description: 'Show or hide the related notes popup.',
    group: 'workspace',
    defaultBinding: 'Meta+r'
  },
  {
    id: 'togglePinCurrentNote',
    label: 'Pin or Unpin Note',
    description: 'Toggle whether the current saved note is pinned.',
    group: 'workspace',
    defaultBinding: 'Meta+p'
  },
  {
    id: 'rememberCurrentNote',
    label: 'New Idea',
    description: 'Save the current note if needed, then start a fresh note.',
    group: 'workspace',
    defaultBinding: 'Meta+s'
  },
  {
    id: 'forgetCurrentNote',
    label: 'Forget Note',
    description: 'Forget the current note. Hold to skip the confirmation dialog.',
    group: 'workspace',
    defaultBinding: 'Meta+Shift+Backspace'
  },
  {
    id: 'searchCurrent',
    label: 'Search Current Note',
    description: 'Focus search in current note scope.',
    group: 'search',
    defaultBinding: 'Meta+f'
  },
  {
    id: 'searchAll',
    label: 'Search All Notes',
    description: 'Focus search in all-notes scope.',
    group: 'search',
    defaultBinding: 'Meta+Shift+f'
  },
  {
    id: 'editorUndo',
    label: 'Undo',
    description: 'Undo last editor change.',
    group: 'editor',
    defaultBinding: 'Meta+z'
  },
  {
    id: 'editorRedo',
    label: 'Redo',
    description: 'Redo editor change.',
    group: 'editor',
    defaultBinding: 'Meta+y',
    additionalBindings: ['Meta+Shift+z']
  },
  {
    id: 'editorInsertBelow',
    label: 'Insert Block Below',
    description: 'Insert new block below current block.',
    group: 'editor',
    defaultBinding: 'Meta+Enter'
  },
  {
    id: 'editorMoveLineUp',
    label: 'Move Block Up',
    description: 'Move current block upward.',
    group: 'editor',
    defaultBinding: 'Alt+ArrowUp'
  },
  {
    id: 'editorMoveLineDown',
    label: 'Move Block Down',
    description: 'Move current block downward.',
    group: 'editor',
    defaultBinding: 'Alt+ArrowDown'
  },
  {
    id: 'editorCutLine',
    label: 'Cut Current Block',
    description: 'Cut whole block when selection is empty.',
    group: 'editor',
    defaultBinding: 'Meta+x'
  },
  {
    id: 'editorHardBreak',
    label: 'Insert Hard Break',
    description: 'Insert line break without splitting block.',
    group: 'editor',
    defaultBinding: 'Shift+Enter'
  },
  {
    id: 'editorSplitLine',
    label: 'Split Line Without Moving Cursor',
    description: 'Insert a newline while keeping the cursor before the break.',
    group: 'editor',
    defaultBinding: 'Ctrl+o',
    nonMacBindings: [],
  },
  {
    id: 'editorDeleteToLineEnd',
    label: 'Delete to End of Line',
    description: 'Delete from the cursor to the end of the line.',
    group: 'editor',
    defaultBinding: 'Ctrl+k',
    nonMacBindings: [],
  },
  {
    id: 'editorStructuralIndent',
    label: 'Indent Block or Selection',
    description: 'Indent the current block or selected lines.',
    group: 'editor',
    defaultBinding: 'Tab',
  },
  {
    id: 'editorStructuralOutdent',
    label: 'Outdent Block or Selection',
    description: 'Outdent the current block or selected lines.',
    group: 'editor',
    defaultBinding: 'Shift+Tab',
  },
  {
    id: 'editorBold',
    label: 'Bold Text',
    description: 'Wrap selected text in bold markers.',
    group: 'editor',
    defaultBinding: 'Meta+b'
  },
  {
    id: 'editorItalic',
    label: 'Italic Text',
    description: 'Wrap selected text in italic markers.',
    group: 'editor',
    defaultBinding: 'Meta+i'
  },
  {
    id: 'editorLink',
    label: 'Link Text',
    description: 'Wrap selected text in a markdown link.',
    group: 'editor',
    defaultBinding: 'Meta+k'
  },
  {
    id: 'searchOpenInSplit',
    label: 'Open Result in Split',
    description: 'Open the selected saved result in a split. For clicks, hold the modifiers of a binding.',
    group: 'search',
    defaultBinding: 'Alt+Enter',
    additionalBindings: ['Meta+Shift+Enter'],
  },
  {
    id: 'editorOpenWikilink',
    label: 'Follow Wikilink',
    description: 'Open the note linked at the editor cursor.',
    group: 'editor',
    defaultBinding: 'Meta+Enter',
    nonMacBindings: ['Ctrl+Enter'],
  },
  {
    id: 'chatSend',
    label: 'Send Chat Message',
    description: 'Send the current chat draft. Shift+Enter inserts a line break.',
    group: 'chat',
    defaultBinding: 'Enter',
    additionalBindings: ['Meta+Enter', 'Ctrl+Enter', 'Alt+Enter'],
  },
  {
    id: 'historyExit',
    label: 'Exit History',
    description: 'Return from History Mode to the editing workspace.',
    group: 'history',
    defaultBinding: 'Escape',
  },
  {
    id: 'historyRename',
    label: 'Rename Revision',
    description: 'Name the focused Note Revision.',
    group: 'history',
    defaultBinding: 'F2',
  },
  {
    id: 'paneChoice1',
    label: 'Pane Picker: First Choice',
    description: 'Choose the first numbered option in the pane picker.',
    group: 'workspace',
    defaultBinding: '1',
  },
  {
    id: 'paneChoice2',
    label: 'Pane Picker: Second Choice',
    description: 'Choose the second numbered option in the pane picker.',
    group: 'workspace',
    defaultBinding: '2',
  },
  {
    id: 'paneChoice3',
    label: 'Pane Picker: Third Choice',
    description: 'Choose the third numbered option in the split pane picker.',
    group: 'workspace',
    defaultBinding: '3',
  },
  {
    id: 'imageViewerClose',
    label: 'Image Viewer: Close',
    description: 'Close the image viewer.',
    group: 'images',
    defaultBinding: 'Escape',
  },
  {
    id: 'imageViewerNext',
    label: 'Image Viewer: Next Image',
    description: 'Show the next image in the viewer.',
    group: 'images',
    defaultBinding: 'ArrowRight',
  },
  {
    id: 'imageViewerPrevious',
    label: 'Image Viewer: Previous Image',
    description: 'Show the previous image in the viewer.',
    group: 'images',
    defaultBinding: 'ArrowLeft',
  },
  {
    id: 'imageViewerZoomIn',
    label: 'Image Viewer: Zoom In',
    description: 'Zoom into the viewed image.',
    group: 'images',
    defaultBinding: '=',
    additionalBindings: ['Shift+Plus', 'Plus'],
  },
  {
    id: 'imageViewerZoomOut',
    label: 'Image Viewer: Zoom Out',
    description: 'Zoom out of the viewed image.',
    group: 'images',
    defaultBinding: '-',
  },
  {
    id: 'imageViewerReset',
    label: 'Image Viewer: Reset Zoom',
    description: 'Fit the viewed image to the window.',
    group: 'images',
    defaultBinding: '0',
  },
  {
    id: 'imageOpen',
    label: 'Editor Image: Open Viewer',
    description: 'Open the selected image in the viewer.',
    group: 'editor',
    defaultBinding: 'Space',
  },
  {
    id: 'imageSource',
    label: 'Editor Image: Edit Source',
    description: 'Edit the source of the selected image.',
    group: 'editor',
    defaultBinding: 'Enter',
  },
  {
    id: 'imageWidth',
    label: 'Editor Image: Edit Width',
    description: 'Move to the width of the selected image.',
    group: 'editor',
    defaultBinding: 'Tab',
  },
  {
    id: 'imageGrow',
    label: 'Editor Image: Increase Size',
    description: 'Increase the selected image size.',
    group: 'editor',
    defaultBinding: '=',
    additionalBindings: ['Shift+Plus', 'Plus'],
  },
  {
    id: 'imageShrink',
    label: 'Editor Image: Decrease Size',
    description: 'Decrease the selected image size.',
    group: 'editor',
    defaultBinding: '-',
  },
  {
    id: 'imageReset',
    label: 'Editor Image: Reset Size',
    description: 'Restore the selected image to its natural size.',
    group: 'editor',
    defaultBinding: '0',
  },
  {
    id: 'imageDelete',
    label: 'Editor Image: Delete',
    description: 'Delete the selected image.',
    group: 'editor',
    defaultBinding: 'Backspace',
    additionalBindings: ['Delete'],
  },
  {
    id: 'imageCopySource',
    label: 'Editor Image: Copy Markdown Source',
    description: 'Copy the selected image’s Markdown source.',
    group: 'editor',
    defaultBinding: 'Meta+c',
    additionalBindings: ['Ctrl+c'],
  },
  {
    id: 'imageCutSource',
    label: 'Editor Image: Cut Markdown Source',
    description: 'Cut the selected image’s Markdown source.',
    group: 'editor',
    defaultBinding: 'Meta+x',
    additionalBindings: ['Ctrl+x'],
  },
  {
    id: 'mapOpen',
    label: 'Map: Open Note',
    description: 'Open the active map note.',
    group: 'map',
    defaultBinding: 'Enter',
  },
  {
    id: 'mapPreview',
    label: 'Map: Preview Note',
    description: 'Preview the focused map note in the reader.',
    group: 'map',
    defaultBinding: 'Space',
  },
  {
    id: 'mapDismiss',
    label: 'Map: Dismiss Note',
    description: 'Close the active map card.',
    group: 'map',
    defaultBinding: 'Escape',
  },
  {
    id: 'mapNext',
    label: 'Map: Next Note',
    description: 'Browse to the next map note.',
    group: 'map',
    defaultBinding: 'ArrowDown',
  },
  {
    id: 'mapPrevious',
    label: 'Map: Previous Note',
    description: 'Browse to the previous map note.',
    group: 'map',
    defaultBinding: 'ArrowUp',
  },
  {
    id: 'mapZoomIn',
    label: 'Map: Zoom In',
    description: 'Zoom into the map.',
    group: 'map',
    defaultBinding: '=',
    additionalBindings: ['Shift+Plus', 'Plus'],
  },
  {
    id: 'mapZoomOut',
    label: 'Map: Zoom Out',
    description: 'Zoom out of the map.',
    group: 'map',
    defaultBinding: '-',
  },
  {
    id: 'mapReset',
    label: 'Map: Reset View',
    description: 'Reset the map view.',
    group: 'map',
    defaultBinding: '0',
  },
  {
    id: 'editorCopyLineUp',
    label: 'Copy Line Up',
    description: 'Copy Line Up in the note body.',
    group: 'editor',
    defaultBinding: 'Alt+Shift+ArrowUp',
  },
  {
    id: 'editorCopyLineDown',
    label: 'Copy Line Down',
    description: 'Copy Line Down in the note body.',
    group: 'editor',
    defaultBinding: 'Alt+Shift+ArrowDown',
  },
  {
    id: 'editorAddCursorAbove',
    label: 'Add Cursor Above',
    description: 'Add Cursor Above in the note body.',
    group: 'editor',
    defaultBinding: 'Meta+Alt+ArrowUp',
    nonMacBindings: ['Ctrl+Alt+ArrowUp'],
  },
  {
    id: 'editorAddCursorBelow',
    label: 'Add Cursor Below',
    description: 'Add Cursor Below in the note body.',
    group: 'editor',
    defaultBinding: 'Meta+Alt+ArrowDown',
    nonMacBindings: ['Ctrl+Alt+ArrowDown'],
  },
  {
    id: 'editorSelectLine',
    label: 'Select Line',
    description: 'Select Line in the note body.',
    group: 'editor',
    defaultBinding: 'Ctrl+l',
    nonMacBindings: ['Alt+l'],
  },
  {
    id: 'editorIndentLess',
    label: 'Decrease Indent',
    description: 'Decrease Indent in the note body.',
    group: 'editor',
    defaultBinding: 'Meta+[',
    nonMacBindings: ['Ctrl+['],
  },
  {
    id: 'editorIndentMore',
    label: 'Increase Indent',
    description: 'Increase Indent in the note body.',
    group: 'editor',
    defaultBinding: 'Meta+]',
    nonMacBindings: ['Ctrl+]'],
  },
  {
    id: 'editorIndentSelection',
    label: 'Indent Selection',
    description: 'Indent Selection in the note body.',
    group: 'editor',
    defaultBinding: 'Meta+Alt+Backslash',
    nonMacBindings: ['Ctrl+Alt+Backslash'],
  },
  {
    id: 'editorDeleteLine',
    label: 'Delete Line',
    description: 'Delete Line in the note body.',
    group: 'editor',
    defaultBinding: 'Meta+Shift+k',
    nonMacBindings: ['Ctrl+Shift+k'],
  },
  {
    id: 'editorMatchingBracket',
    label: 'Go to Matching Bracket',
    description: 'Go to Matching Bracket in the note body.',
    group: 'editor',
    defaultBinding: 'Meta+Shift+Backslash',
    nonMacBindings: ['Ctrl+Shift+Backslash'],
  },
  {
    id: 'editorToggleComment',
    label: 'Toggle Line Comment',
    description: 'Toggle Line Comment in the note body.',
    group: 'editor',
    defaultBinding: 'Meta+/',
    nonMacBindings: ['Ctrl+/'],
  },
  {
    id: 'editorToggleBlockComment',
    label: 'Toggle Block Comment',
    description: 'Toggle Block Comment in the note body.',
    group: 'editor',
    defaultBinding: 'Ctrl+Shift+a',
    nonMacBindings: ['Alt+Shift+a'],
  },
  {
    id: 'editorToggleTabFocus',
    label: 'Toggle Tab Focus Mode',
    description: 'Toggle Tab Focus Mode in the note body.',
    group: 'editor',
    defaultBinding: 'Alt+Shift+m',
    nonMacBindings: ['Ctrl+m'],
  },
  {
    id: 'editorSimplifySelection',
    label: 'Clear Extra Cursors',
    description: 'Clear Extra Cursors in the note body.',
    group: 'editor',
    defaultBinding: 'Escape',
  },
] as const satisfies readonly KeyboardShortcutDefinition[];

const recentNoteDefinitions = Array.from({ length: 9 }, (_, index) => {
  const slot = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  return {
    id: `recentNote${slot}` as const,
    label: `Open Recent Note ${slot}`,
    description: `Open recent note slot ${slot} from search bar.`,
    group: 'search',
    defaultBinding: `Ctrl+${slot}`
  } satisfies KeyboardShortcutDefinition;
});

export const keyboardShortcutDefinitions = [
  ...shortcutDefinitionsBase,
  ...recentNoteDefinitions
] as const satisfies readonly KeyboardShortcutDefinition[];

export const keyboardShortcutDefinitionsById = keyboardShortcutDefinitions.reduce(
  (accumulator, definition) => {
    accumulator[definition.id] = definition;
    return accumulator;
  },
  {} as Record<KeyboardShortcutId, KeyboardShortcutDefinition>
);

export const defaultKeyboardShortcutBindings = keyboardShortcutDefinitions.reduce(
  (bindings, definition: KeyboardShortcutDefinition) => {
    bindings[definition.id] = normalizeCommandBindings(definition.id, [definition.defaultBinding, ...(definition.additionalBindings ?? [])]);
    return bindings;
  }, {} as KeyboardShortcutBindings
);

function cloneDefaults(): KeyboardShortcutBindings {
  return Object.fromEntries(Object.entries(defaultKeyboardShortcutBindings).map(([id, bindings]) => [id, [...bindings]])) as KeyboardShortcutBindings;
}

/** Read the old single-binding format without losing remaps or disabled actions. */
export function resolveStoredKeyboardShortcutBindings(value: unknown): KeyboardShortcutBindings {
  const next = cloneDefaults();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return next;
  const stored = value as Record<string, unknown>;
  for (const definition of keyboardShortcutDefinitions) {
    const raw = stored[definition.id];
    if (typeof raw === 'string') next[definition.id] = normalizeCommandBindings(definition.id, [raw]);
    else if (Array.isArray(raw) && raw.every(binding => typeof binding === 'string')) {
      next[definition.id] = normalizeCommandBindings(definition.id, raw);
    }
  }
  if (!Array.isArray(stored.editorRedo) && (typeof stored.editorRedo === 'string' || typeof stored.editorRedoAlternate === 'string')) {
    next.editorRedo = normalizeCommandBindings('editorRedo', [
      typeof stored.editorRedo === 'string' ? stored.editorRedo : 'Meta+y',
      typeof stored.editorRedoAlternate === 'string' ? stored.editorRedoAlternate : 'Meta+Shift+z'
    ]);
  }
  return next;
}

function normalizeBindings(bindings: readonly string[]): string[] {
  return [...new Set(bindings.map(normalizeShortcutBinding).filter(Boolean))];
}

function normalizeCommandBindings(id: KeyboardShortcutId, bindings: readonly string[]): string[] {
  const modifiersOnly = getShortcutDefinition(id).activation === 'holdModifiers';
  return normalizeBindings(bindings).filter(binding => (parseShortcutBinding(binding)!.key === '') === modifiersOnly);
}

class KeyboardShortcutsStore {
  bindings = $state<KeyboardShortcutBindings>(readStoredKeyboardShortcutBindings());
  recording = $state(false);

  setBindings = (id: KeyboardShortcutId, bindings: readonly string[]) => {
    const next = { ...this.bindings, [id]: normalizeCommandBindings(id, bindings) };
    this.bindings = next;
    persistKeyboardShortcutBindings(next);
  };

  resetBinding = (id: KeyboardShortcutId) => this.setBindings(id, defaultKeyboardShortcutBindings[id]);
  resetAll = () => {
    this.bindings = cloneDefaults();
    persistKeyboardShortcutBindings(this.bindings);
  };
}

export const keyboardShortcuts = new KeyboardShortcutsStore();

export function getShortcutDefinition(id: KeyboardShortcutId) {
  return keyboardShortcutDefinitionsById[id];
}

function currentPlatform() {
  return typeof navigator === 'undefined' ? '' : navigator.platform;
}

export function getEffectiveKeyboardShortcutBindings(
  id: KeyboardShortcutId,
  bindings: KeyboardShortcutBindings = keyboardShortcuts.bindings,
  platform = currentPlatform()
): string[] {
  const definition = getShortcutDefinition(id);
  if (definition.nonMacBindings && !/Mac|iPhone|iPad|iPod/i.test(platform) && !isKeyboardShortcutCustomized(id, bindings)) return normalizeBindings(definition.nonMacBindings);
  return bindings[id].map(binding =>
    id === 'editorLink' && binding === 'Meta+k' && !/Mac|iPhone|iPad|iPod/i.test(platform)
      && !isKeyboardShortcutCustomized(id, bindings) ? 'Ctrl+k' : binding
  );
}

/** Primary binding for compact labels; dispatch always considers every binding. */
export function getEffectiveKeyboardShortcutBinding(
  id: KeyboardShortcutId,
  bindings: KeyboardShortcutBindings = keyboardShortcuts.bindings,
  platform = currentPlatform()
) {
  return getEffectiveKeyboardShortcutBindings(id, bindings, platform)[0] ?? '';
}

export function getEffectiveDefaultKeyboardShortcutBinding(id: KeyboardShortcutId, platform = currentPlatform()) {
  return getEffectiveKeyboardShortcutBinding(id, defaultKeyboardShortcutBindings, platform);
}

export function getKeyboardShortcutBinding(id: KeyboardShortcutId) {
  return keyboardShortcuts.bindings[id][0] ?? '';
}

export function formatKeyboardShortcutBindings(id: KeyboardShortcutId): string {
  return getEffectiveKeyboardShortcutBindings(id).map(formatShortcutBinding).join(' or ');
}

export function setKeyboardShortcutBindings(id: KeyboardShortcutId, bindings: readonly string[]) {
  keyboardShortcuts.setBindings(id, bindings);
}

export function setKeyboardShortcutBinding(id: KeyboardShortcutId, binding: string) {
  keyboardShortcuts.setBindings(id, [binding]);
}

export function resetKeyboardShortcutBinding(id: KeyboardShortcutId) {
  keyboardShortcuts.resetBinding(id);
}

export function resetAllKeyboardShortcuts() {
  keyboardShortcuts.resetAll();
}

export function isKeyboardShortcutCustomized(id: KeyboardShortcutId, bindings: KeyboardShortcutBindings = keyboardShortcuts.bindings) {
  return JSON.stringify(bindings[id]) !== JSON.stringify(defaultKeyboardShortcutBindings[id]);
}

export function getShortcutBindingParts(binding: string): string[] {
  const parsed = parseShortcutBinding(binding);
  if (!parsed) return ['Disabled'];

  const parts: string[] = [];
  if (parsed.metaKey) parts.push('Cmd');
  if (parsed.ctrlKey) parts.push('Ctrl');
  if (parsed.altKey) parts.push('Option');
  if (parsed.shiftKey) parts.push('Shift');
  if (parsed.key) parts.push(formatShortcutKey(parsed.key));
  return parts;
}

export function formatShortcutBinding(binding: string) {
  return getShortcutBindingParts(binding).join(' + ');
}

export function recordShortcutBindingFromEvent(event: KeyboardEvent, options: { modifiersOnly?: boolean } = {}) {
  if (options.modifiersOnly) {
    if (!MODIFIER_ONLY_CODES.has(event.code) && !['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;
    return normalizeShortcutBinding(buildModifierTokens(event).join('+')) || null;
  }
  const key = getEventKeyToken(event);
  if (!key) {
    return null;
  }

  return normalizeShortcutBinding(
    [...buildModifierTokens(event), key].join('+')
  );
}

export function keyboardShortcutMatchesEvent(
  event: KeyboardEvent,
  id: KeyboardShortcutId,
  bindings: KeyboardShortcutBindings = keyboardShortcuts.bindings,
  platform = currentPlatform()
) {
  if (restartLifecycle.workspaceMutationsBlocked || keyboardShortcuts.recording || event.isComposing) return false;
  return getEffectiveKeyboardShortcutBindings(id, bindings, platform).some(binding => shortcutBindingMatchesEvent(event, binding));
}

/** Match held modifiers for a preview action or a pointer alternative. */
export function keyboardShortcutModifiersMatchEvent(
  event: Partial<Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>>,
  id: KeyboardShortcutId
) {
  if (keyboardShortcuts.recording || restartLifecycle.workspaceMutationsBlocked) return false;
  return getEffectiveKeyboardShortcutBindings(id).some(binding => {
    const parsed = parseShortcutBinding(binding);
    return parsed && (parsed.metaKey || parsed.ctrlKey || parsed.altKey || parsed.shiftKey)
      && (!parsed.metaKey || event.metaKey) && (!parsed.ctrlKey || event.ctrlKey)
      && (!parsed.altKey || event.altKey) && (!parsed.shiftKey || event.shiftKey);
  });
}

export function shortcutBindingMatchesEvent(event: KeyboardEvent, binding: string) {
  const parsed = parseShortcutBinding(binding);
  if (!parsed || !parsed.key) {
    return false;
  }

  const eventKey = getEventKeyToken(event);
  if (!eventKey) {
    return false;
  }

  // Shift/Option can change punctuation (for example Shift+Backslash emits |).
  // Match defaults expressed with the base key as well as recorded characters.
  const punctuationCode = /^(Slash|Comma|Period|Semicolon|Quote|Minus|Equal|BracketLeft|BracketRight|Backslash|Backquote)$/.test(event.code ?? '');
  const keyMatches = parsed.key === eventKey || (punctuationCode && parsed.key === normalizeKeyToken(event.code));
  return (
    keyMatches &&
    parsed.metaKey === !!event.metaKey &&
    parsed.ctrlKey === !!event.ctrlKey &&
    parsed.altKey === !!event.altKey &&
    parsed.shiftKey === !!event.shiftKey
  );
}

export function usesNativeCutShortcut(id: KeyboardShortcutId, event?: KeyboardEvent) {
  return keyboardShortcuts.bindings[id].some(binding => (binding === 'Meta+x' || binding === 'Ctrl+x')
    && (!event || shortcutBindingMatchesEvent(event, binding)));
}

function shortcutContextsOverlap(a: KeyboardShortcutId, b: KeyboardShortcutId): boolean {
  const groupA = getShortcutDefinition(a).group, groupB = getShortcutDefinition(b).group;
  if (groupA === 'navigation' || groupB === 'navigation') return true;
  // These pairs act on mutually exclusive editor selections.
  const exclusivePairs: readonly (readonly KeyboardShortcutId[])[] = [
    ['editorOpenWikilink', 'editorInsertBelow'],
    ['imageWidth', 'editorStructuralIndent'],
    ['imageCutSource', 'editorCutLine'],
  ];
  if (exclusivePairs.some(pair => pair.includes(a) && pair.includes(b))) return false;
  if (groupA === groupB) return true;
  const workspace = ['workspace', 'editor', 'search', 'chat'];
  return (groupA === 'workspace' || groupB === 'workspace') && workspace.includes(groupA) && workspace.includes(groupB);
}

export function getShortcutBindingConflicts(id: KeyboardShortcutId, binding: string,
  bindings: KeyboardShortcutBindings = keyboardShortcuts.bindings, platform = currentPlatform()) {
  return keyboardShortcutDefinitions.filter(other => other.id !== id && shortcutContextsOverlap(id, other.id)
    && getEffectiveKeyboardShortcutBindings(other.id, bindings, platform).includes(binding)).map(other => other.id);
}

export function getKeyboardShortcutConflicts(bindings: KeyboardShortcutBindings = keyboardShortcuts.bindings, platform = currentPlatform()) {
  return Object.fromEntries(keyboardShortcutDefinitions.map(definition => [definition.id,
    [...new Set(getEffectiveKeyboardShortcutBindings(definition.id, bindings, platform)
      .flatMap(binding => getShortcutBindingConflicts(definition.id, binding, bindings, platform)))]])) as Record<KeyboardShortcutId, KeyboardShortcutId[]>;
}

function normalizeShortcutBinding(binding: string) {
  if (binding.trim() === '') {
    return '';
  }

  const parsed = parseShortcutBinding(binding);
  if (!parsed) {
    return '';
  }

  const parts = [];
  if (parsed.metaKey) parts.push('Meta');
  if (parsed.ctrlKey) parts.push('Ctrl');
  if (parsed.altKey) parts.push('Alt');
  if (parsed.shiftKey) parts.push('Shift');
  if (parsed.key) parts.push(parsed.key);
  return parts.join('+');
}

export function parseShortcutBinding(binding: string): ParsedShortcutBinding | null {
  if (binding.trim() === '') {
    return null;
  }

  const tokens = binding
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const modifiersOnly = tokens.every(token => MODIFIER_ORDER.includes(token as ModifierToken));
  const key = modifiersOnly ? '' : tokens.at(-1)!;
  const modifiers = new Set(modifiersOnly ? tokens : tokens.slice(0, -1));
  for (const modifier of modifiers) {
    if (!MODIFIER_ORDER.includes(modifier as ModifierToken)) {
      return null;
    }
  }

  return {
    key: normalizeKeyToken(key),
    metaKey: modifiers.has('Meta'),
    ctrlKey: modifiers.has('Ctrl'),
    altKey: modifiers.has('Alt'),
    shiftKey: modifiers.has('Shift')
  };
}

function buildModifierTokens(event: KeyboardEvent): ModifierToken[] {
  const modifiers: ModifierToken[] = [];
  if (event.metaKey) modifiers.push('Meta');
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  return modifiers;
}

function getEventKeyToken(event: Pick<KeyboardEvent, 'code' | 'key'> & Partial<Pick<KeyboardEvent, 'altKey'>>) {
  // Option can produce a printable alternate character on macOS. Keep the
  // physical letter stable for recording and dispatch.
  if (event.altKey && /^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if ('code' in event && MODIFIER_ONLY_CODES.has(event.code)) {
    return null;
  }

  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.key)) return event.key;
  if (event.key === '+') return 'Plus';
  if (NAMED_KEY_TOKENS.has(event.key)) {
    return event.key;
  }

  switch (event.key) {
    case ' ':
      return 'Space';
    default:
      if (event.key.length === 1) {
        return normalizePrintableKey(event.key);
      }
      return null;
  }
}

export function formatShortcutKey(key: string) {
  if (key.length === 1) {
    return /^[a-z]$/.test(key) ? key.toUpperCase() : key;
  }

  switch (key) {
    case 'ArrowUp':
      return 'Up';
    case 'ArrowDown':
      return 'Down';
    case 'ArrowLeft':
      return 'Left';
    case 'ArrowRight':
      return 'Right';
    case 'Space':
      return 'Space';
    case 'Plus':
      return '+';
    default:
      return key;
  }
}

function normalizeKeyToken(key: string) {
  if (NAMED_KEY_TOKENS.has(key)) {
    return key;
  }

  if (/^Key[A-Z]$/.test(key)) {
    return key.slice(3).toLowerCase();
  }

  if (/^Digit[0-9]$/.test(key)) {
    return key.slice(5);
  }

  switch (key) {
    case 'Slash':
      return '/';
    case 'Comma':
      return ',';
    case 'Period':
      return '.';
    case 'Semicolon':
      return ';';
    case 'Quote':
      return "'";
    case 'Minus':
      return '-';
    case 'Equal':
      return '=';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Backslash':
      return '\\';
    case 'Backquote':
      return '`';
    default:
      if (key.length === 1) {
        return normalizePrintableKey(key);
      }
      return key;
  }
}

function normalizePrintableKey(key: string) {
  return /^[A-Z]$/.test(key) ? key.toLowerCase() : key;
}

function readStoredKeyboardShortcutBindings(): KeyboardShortcutBindings {
  if (!isBrowser()) return cloneDefaults();
  try {
    const raw = window.localStorage.getItem(KEYBOARD_SHORTCUTS_STORAGE_KEY);
    return raw ? resolveStoredKeyboardShortcutBindings(JSON.parse(raw)) : cloneDefaults();
  } catch (error) {
    logDevError('Failed to parse stored keyboard shortcuts; using defaults', error);
    return cloneDefaults();
  }
}

function persistKeyboardShortcutBindings(bindings: KeyboardShortcutBindings) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(KEYBOARD_SHORTCUTS_STORAGE_KEY, JSON.stringify(bindings));
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
