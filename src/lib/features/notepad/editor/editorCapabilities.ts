import { describeBlockAt, type BlockDescriptor } from '$lib/features/notepad/editor/blockTypes';
import {
  readEditorState,
  replaceEditorDocument,
  focusEditorSelection,
  setEditorCurrentSearchHighlightQuery,
  setProposalReviewExtensions,
  type EditorController,
  type EditorSnapshot,
  type SearchHighlightOptions
} from '$lib/features/notepad/editor/editor';
import { slashMenuHideFromUi } from './slashMenu';
import { selectionMenuHideFromUi } from './selectionMenu';
import {
  Transaction,
  type Annotation,
  type ChangeSpec,
  type Extension,
  type StateEffect
} from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { ProposalReviewState } from '$lib/features/proposals/reviewExtension';

export interface EditorSelectionCapabilitySnapshot {
  anchor: number;
  head: number;
  selectedText: string;
}

export interface EditorCurrentBlockSnapshot {
  block: BlockDescriptor;
  text: string;
}

export interface ReadOnlyOverlayHandle {
  dispose: () => void;
}

export type EditorMarkdownInsertTarget = 'selection' | 'cursor' | 'end';

export interface EditorMarkdownInsertOptions {
  target?: EditorMarkdownInsertTarget;
  focus?: boolean;
  scrollIntoView?: boolean;
}

export interface EditorMarkdownInsertResult {
  from: number;
  to: number;
  cursor: number;
}

export interface EditorCapabilityAdapter {
  /** True when the live CodeMirror controller (and review compartment) exist. */
  isReady: () => boolean;
  focus: () => boolean;
  focusAtEnd: () => boolean;
  readSnapshot: () => EditorSnapshot | null;
  readSelection: () => EditorSelectionCapabilitySnapshot | null;
  readCurrentBlock: () => EditorCurrentBlockSnapshot | null;
  replaceDocument: (
    markdown: string,
    options?: {
      anchor?: number | null;
      head?: number | null;
      focus?: boolean;
      scrollSelectionIntoView?: boolean;
    }
  ) => boolean;
  insertMarkdown: (
    markdown: string,
    options?: EditorMarkdownInsertOptions
  ) => EditorMarkdownInsertResult | null;
  setSearchHighlight: (
    query: SearchHighlightOptions | string | null
  ) => boolean;
  focusSearchRange: (
    range: { from: number; to: number } | null | undefined
  ) => boolean;
  /** Restores an arbitrary saved selection and takes focus. */
  focusSelection: (
    selection: { anchor: number; head: number } | null | undefined,
    options?: { scrollIntoView?: boolean }
  ) => boolean;
  closeSlashMenu: () => void;
  closeSelectionMenu: () => void;
  addReadOnlyOverlay: (className: string) => ReadOnlyOverlayHandle;
  setProposalReviewExtensions: (
    extension: Extension | readonly Extension[] | null
  ) => boolean;
  setProposalReviewStateReader?: (
    reader: ((state: import('@codemirror/state').EditorState) => ProposalReviewState) | null
  ) => void;
  readProposalReviewState?: () => ProposalReviewState | null;
  focusProposalHunk?: (id: string) => boolean;
  applyChanges?: (
    changes: ChangeSpec | readonly ChangeSpec[],
    annotation?: Annotation<unknown>
  ) => boolean;
  dispatchEffects?: (effects: StateEffect<unknown> | readonly StateEffect<unknown>[]) => boolean;
  getDocumentText?: () => string | null;
}

export function insertEditorMarkdown(
  controller: EditorController | null,
  markdown: string,
  { target = 'selection', focus = false, scrollIntoView = true }: EditorMarkdownInsertOptions = {}
): EditorMarkdownInsertResult | null {
  if (!controller) {
    return null;
  }

  const state = controller.view.state;
  const selection = state.selection.main;
  const range =
    target === 'end'
      ? { from: state.doc.length, to: state.doc.length }
      : target === 'cursor'
        ? { from: selection.head, to: selection.head }
        : { from: selection.from, to: selection.to };
  const cursor = range.from + markdown.length;

  // Keep the insertion in one transaction so it is one undo step and the
  // shared editor runtime can forward the same atomic change to sibling panes.
  controller.view.dispatch(
    state.update({
      changes: { from: range.from, to: range.to, insert: markdown },
      selection: { anchor: cursor },
      scrollIntoView,
      annotations: Transaction.userEvent.of('input.chat-insert')
    })
  );

  if (focus) {
    controller.view.focus();
  }

  return { ...range, cursor };
}

export function createEditorCapabilityAdapter(
  getController: () => EditorController | null
): EditorCapabilityAdapter {
  let reviewStateReader: ((state: import('@codemirror/state').EditorState) => ProposalReviewState) | null = null;
  return {
    isReady: () => {
      const controller = getController();
      return Boolean(controller?.view && controller.proposalReviewCompartment);
    },
    focus: () => {
      const controller = getController();
      if (!controller) return false;
      controller.view.focus();
      return true;
    },
    focusAtEnd: () => {
      const controller = getController();
      if (!controller) return false;
      const anchor = controller.view.state.doc.length;
      controller.view.dispatch(
        controller.view.state.update({
          selection: { anchor },
          scrollIntoView: true
        })
      );
      controller.view.focus();
      return true;
    },
    readSnapshot: () => readEditorState(getController()),
    readSelection: () => {
      const controller = getController();
      if (!controller) {
        return null;
      }
      const selection = controller.view.state.selection.main;
      return {
        anchor: selection.anchor,
        head: selection.head,
        selectedText: controller.view.state.sliceDoc(selection.from, selection.to)
      };
    },
    readCurrentBlock: () => {
      const controller = getController();
      if (!controller) {
        return null;
      }
      const position = controller.view.state.selection.main.head;
      const block = describeBlockAt(controller.view.state, position);
      if (!block) {
        return null;
      }
      return {
        block,
        text: controller.view.state.sliceDoc(block.from, block.to)
      };
    },
    replaceDocument: (markdown, options = {}) =>
      replaceEditorDocument(getController(), markdown, options),
    insertMarkdown: (markdown, options = {}) =>
      insertEditorMarkdown(getController(), markdown, options),
    setSearchHighlight: (query) =>
      setEditorCurrentSearchHighlightQuery(getController(), query),
    focusSearchRange: (range) =>
      focusEditorSelection(
        getController(),
        range ? { anchor: range.from, head: range.to } : range
      ),
    focusSelection: (selection, options) =>
      focusEditorSelection(getController(), selection, options),
    closeSlashMenu: () => {
      const controller = getController();
      if (controller) slashMenuHideFromUi(controller.view);
    },
    closeSelectionMenu: () => {
      const controller = getController();
      if (controller) selectionMenuHideFromUi(controller.view);
    },
    addReadOnlyOverlay: (className) => {
      const controller = getController();
      if (!controller) {
        return { dispose: () => {} };
      }
      const overlay = document.createElement('div');
      overlay.className = className;
      overlay.dataset.editorOverlay = 'readonly';
      controller.view.dom.appendChild(overlay);
      return {
        dispose: () => {
          overlay.remove();
        }
      };
    },
    setProposalReviewExtensions: (extension: Extension | readonly Extension[] | null) =>
      setProposalReviewExtensions(getController(), extension),
    setProposalReviewStateReader: (reader) => {
      reviewStateReader = reader;
    },
    readProposalReviewState: () => {
      const controller = getController();
      return controller && reviewStateReader ? reviewStateReader(controller.view.state) : null;
    },
    focusProposalHunk: (id) => {
      const controller = getController();
      const hunk = controller && reviewStateReader?.(controller.view.state).hunks.find((item) => item.id === id);
      if (!controller || !hunk) return false;
      controller.view.dispatch(controller.view.state.update({
        selection: { anchor: hunk.from, head: hunk.to },
        scrollIntoView: true
      }));
      controller.view.focus();
      return true;
    },
    applyChanges: (changes, annotation) => {
      const controller = getController();
      if (!controller) return false;
      controller.view.dispatch(
        controller.view.state.update({
          changes,
          annotations: [
            Transaction.addToHistory.of(false),
            isolateHistory.of('full'),
            ...(annotation ? [annotation] : [])
          ]
        })
      );
      return true;
    },
    dispatchEffects: (effects) => {
      const controller = getController();
      if (!controller) return false;
      controller.view.dispatch(controller.view.state.update({ effects }));
      return true;
    },
    getDocumentText: () => getController()?.view.state.doc.toString() ?? null
  };
}
