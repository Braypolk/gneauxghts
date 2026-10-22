/** Pane-local native input selection projected onto canonical Markdown offsets. */
export interface NativeSelectionMenuTarget {
  /** Return null when the input, source, composition or selection is no longer current. */
  read(): { from: number; to: number } | null;
  anchor: {
    getBoundingClientRect(): DOMRect;
    contextElement: Element;
  };
  /** Restore the command's resulting canonical selection in the current input. */
  restoreSelection(range: { from: number; to: number }): void;
}
