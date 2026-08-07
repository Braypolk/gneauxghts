/**
 * Stable editor compatibility façade.
 *
 * CodeMirror lifecycle and runtime implementation live in the focused modules
 * beside this file. Feature consumers should prefer EditorCapabilityAdapter;
 * pane internals may continue importing this façade while ownership migrates.
 */
export type {
  CreateEditorOptions,
  EditorController,
  EditorSelection,
  EditorSnapshot,
  EditorViewCallbacks,
  ProposalReviewExtension,
  ReplaceEditorContentOptions,
  ReplaceEditorDocumentOptions,
  RestoreCursorPositionOptions,
  SearchHighlightOptions,
  SharedEditorResources,
  SwapEditorRuntimeOptions
} from './types';

export {
  EditorDocumentRuntime,
  buildRootForwardSpec
} from './editorDocumentRuntime';
export {
  createSharedEditorResources,
  type CreateSharedEditorResourcesOptions
} from './editorDocumentResources';
export { markdownEnter } from './editorShortcuts';
export {
  focusEditorSelection,
  setEditorCurrentSearchHighlightQuery
} from './searchHighlightExtension';
export {
  alignEditorScrollToSelection,
  createEditor,
  destroyEditor,
  insertWikilinkSuggestion,
  prepareEditor,
  readCursorPosition,
  readEditorState,
  replaceEditorContent,
  replaceEditorDocument,
  restoreCursorPosition,
  setProposalReviewExtensions,
  swapEditorRuntime
} from './editorViewController';
