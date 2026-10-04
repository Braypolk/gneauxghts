import { EditorState, Transaction, type TransactionSpec, type EditorStateConfig } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { vi } from 'vitest';

/** State-backed command surface. Deliberately contains no layout/DOM simulation. */
export function createCommandView(config: EditorStateConfig | EditorState) {
  let state = config instanceof EditorState ? config : EditorState.create(config);
  const transactions: Transaction[] = [];
  const view = {
    get state() { return state; },
    composing: false,
    dom: { isConnected: true },
    focus: vi.fn(),
    dispatch(...specs: (Transaction | TransactionSpec)[]) {
      const batch = specs[0] instanceof Transaction ? specs as Transaction[] : [state.update(...specs as TransactionSpec[])];
      for (const transaction of batch) {
        if (transaction.startState !== state) throw new RangeError('Transaction starts from an obsolete state');
        transactions.push(transaction); state = transaction.state;
      }
    }
  } as unknown as EditorView;
  return { view, transactions };
}
