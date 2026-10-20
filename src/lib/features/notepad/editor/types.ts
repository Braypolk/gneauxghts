import type { DocumentBody } from '../document/documentBody';
import type { EditorView } from '@codemirror/view';
import type { ImagesConfig } from '$lib/features/notepad/images/imageConfig';
import type { ActiveWikilink } from '$lib/features/notepad/wikilinks/wikilinks';
import type { EditorDocumentRuntime } from './editorDocumentRuntime';
import type { ImageViewerSession } from '../images/imageViewerModel';
import type { ExternalLinkActionsSession } from './externalLinkExtension';

export interface EditorSelection {
  anchor: number;
  head: number;
}

export interface EditorSnapshot {
  markdown: string;
  selection: EditorSelection;
  revision: number;
}

export interface EditorController {
  view: EditorView;
  runtime: EditorDocumentRuntime;
  sharedResources: SharedEditorResources | null;
  paneKey: symbol;
  onBodyChange: (body: DocumentBody) => void;
}

export interface EditorViewCallbacks {
  onOpenExternalLinkActions?: (session: ExternalLinkActionsSession) => void;
  onOpenImageViewer?: (session: ImageViewerSession) => void;
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
  onViewStateChange: () => void;
}

export interface SearchHighlightOptions {
  query: string;
  matchCase: boolean;
  matchWholeWord: boolean;
}

export interface SharedEditorResources {
  imagesConfig: ImagesConfig;
  registerViewCallbacks: (view: EditorView, callbacks: EditorViewCallbacks) => void;
  unregisterViewCallbacks: (view: EditorView) => void;
  resolveViewCallbacks: (view: EditorView) => EditorViewCallbacks | null;
  runtime: EditorDocumentRuntime;
  destroy: () => void;
}

export interface CreateEditorOptions {
  editorRoot: HTMLDivElement;
  initialValue: string;
  onBodyChange: (body: DocumentBody) => void;
  initialState?: EditorSnapshot | null;
  sharedResources?: SharedEditorResources | null;
  viewCallbacks?: EditorViewCallbacks;
}

export interface ReplaceEditorContentOptions {
  flushHistory?: boolean;
}

export interface ReplaceEditorDocumentOptions {
  anchor?: number | null;
  head?: number | null;
  focus?: boolean;
  scrollSelectionIntoView?: boolean;
}

export interface SwapEditorRuntimeOptions {
  sharedResources: SharedEditorResources;
  initialValue: string;
  initialState?: EditorSnapshot | null;
  viewCallbacks: EditorViewCallbacks;
  onBodyChange: (body: DocumentBody) => void;
}

export interface RestoreCursorPositionOptions {
  scrollIntoView?: boolean;
}
