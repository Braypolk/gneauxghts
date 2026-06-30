import { describeBlockAt, type BlockDescriptor } from '$lib/features/notepad/editor/blockTypes';
import {
  readEditorState,
  replaceEditorDocument,
  type EditorController,
  type EditorSnapshot
} from '$lib/features/notepad/editor/editor';

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

export interface EditorCapabilityAdapter {
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
  addReadOnlyOverlay: (className: string) => ReadOnlyOverlayHandle;
}

export function createEditorCapabilityAdapter(
  getController: () => EditorController | null
): EditorCapabilityAdapter {
  return {
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
    }
  };
}
