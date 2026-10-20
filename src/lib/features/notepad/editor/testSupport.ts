import type { DocumentBody } from '../document/documentBody';
import { EditorState, Transaction, type TransactionSpec, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { vi } from 'vitest';
import type { EditorDocumentRuntime } from './editorDocumentRuntime';
import type { EditorController } from './types';

export function createRuntimePane(
  runtime: EditorDocumentRuntime,
  markdown: string,
  anchor: number,
  onBodyChange: (body: DocumentBody) => void = vi.fn(),
  extensions: Extension[] = []
) {
  let state = EditorState.create({
    doc: markdown,
    selection: { anchor },
    extensions
  });
  const scrollDOM = {
    scrollTop: 0,
    scrollLeft: 0
  };
  const view = {
    composing: false,
    dom: { isConnected: true },
    focus: vi.fn(),
    get state() {
      return state;
    },
    update(transactions: readonly Transaction[]) {
      for (const transaction of transactions) {
        if (transaction.startState !== state) {
          throw new RangeError('Transaction does not start from the current pane state');
        }
        state = transaction.state;
      }
      if (transactions.some((transaction) => transaction.docChanged)) {
        // A real view may adjust its viewport while applying document changes.
        scrollDOM.scrollTop = 0;
        scrollDOM.scrollLeft = 0;
      }
    },
    dispatch(spec: Transaction | TransactionSpec) {
      const transaction =
        spec instanceof Transaction ? spec : state.update(spec);
      runtime.dispatchFromPane(controller, [transaction]);
    },
    scrollDOM
  } as unknown as EditorView;
  const controller: EditorController = {
    view,
    runtime,
    sharedResources: null,
    paneKey: Symbol('pane'),
    onBodyChange
  };
  runtime.attachController(controller);
  return {
    controller,
    view,
    onBodyChange,
    readState: () => state,
    setViewport: (scrollTop: number, scrollLeft = 0) => {
      scrollDOM.scrollTop = scrollTop;
      scrollDOM.scrollLeft = scrollLeft;
    },
    readViewport: () => ({ ...scrollDOM })
  };
}
