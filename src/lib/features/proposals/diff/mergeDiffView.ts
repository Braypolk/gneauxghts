import { defaultKeymap } from '@codemirror/commands';
import { unifiedMergeView } from '@codemirror/merge';
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { EditorView } from '@codemirror/view';

import { createMarkdownHighlight } from '$lib/features/notepad/markdown/markdownHighlight';
import { createMarkdownLanguage } from '$lib/features/notepad/markdown/markdownLanguage';

// A read-only, single-pane (unified) Markdown diff built on `@codemirror/merge`.
//
// The editor's document holds the PROPOSED ("new") text; `original` holds the
// CURRENT ("old") text. `unifiedMergeView` renders deletions inline above the
// changed lines and marks insertions, so the whole proposal reads as one
// document with change highlighting — the Phase C inbox review surface.
//
// This is review-only in v1 (the plan keeps editing out of scope), so:
//  - `EditorState.readOnly` + non-editable view (no text mutation),
//  - `mergeControls: false` (per-chunk accept/reject is driven by the inbox's
//    own approve/reject buttons, not CodeMirror's inline controls).
// Accept/reject still happens at the file (and, later, op) granularity through
// the existing inbox flow; this component only visualizes.

export interface MergeDiffOptions {
  /** Current note text (the "old" side of the diff). */
  original: string;
  /** Proposed note text (the "new" side — the editor document). */
  proposed: string;
  /** Collapse long unchanged stretches to a "changed regions only" view. */
  collapseUnchanged?: boolean;
  /** DOM node to mount into. */
  parent: HTMLElement;
}

export interface MergeDiffHandle {
  readonly view: EditorView;
  /** Rebuild with new text and/or collapse setting. */
  update(options: Pick<MergeDiffOptions, 'original' | 'proposed' | 'collapseUnchanged'>): void;
  destroy(): void;
}

// Margin/minSize tuned so a couple of context lines stay visible around each
// change when collapsing — enough to orient without showing the whole file.
const COLLAPSE_CONFIG = { margin: 2, minSize: 4 } as const;

function buildExtensions(options: MergeDiffOptions): Extension[] {
  return [
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    EditorView.lineWrapping,
    // Read-only views still want copy/select; nothing here mutates the doc.
    keymap.of(defaultKeymap),
    createMarkdownLanguage(),
    createMarkdownHighlight(),
    unifiedMergeView({
      original: options.original,
      mergeControls: false,
      gutter: true,
      highlightChanges: true,
      syntaxHighlightDeletions: true,
      collapseUnchanged: options.collapseUnchanged ? COLLAPSE_CONFIG : undefined
    }),
    mergeDiffTheme
  ];
}

function buildState(options: MergeDiffOptions): EditorState {
  return EditorState.create({
    doc: options.proposed,
    extensions: buildExtensions(options)
  });
}

export function createMergeDiffView(options: MergeDiffOptions): MergeDiffHandle {
  const view = new EditorView({
    state: buildState(options),
    parent: options.parent
  });

  let current = options;

  return {
    view,
    update(next) {
      const merged: MergeDiffOptions = {
        parent: current.parent,
        original: next.original,
        proposed: next.proposed,
        collapseUnchanged: next.collapseUnchanged ?? current.collapseUnchanged
      };
      current = merged;
      // The original doc and collapse config are baked into the extension set, so
      // a full state swap is the clean way to reconfigure both at once for a
      // short-lived review view. (No history/selection to preserve here.)
      view.setState(buildState(merged));
    },
    destroy() {
      view.destroy();
    }
  };
}

// Align the merge view's change colors with the app's CSS custom properties so
// the diff matches the rest of the inbox surface in both themes.
const mergeDiffTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    fontSize: '0.875rem'
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.6'
  },
  '.cm-content': {
    caretColor: 'transparent'
  },
  '.cm-changedLine': {
    backgroundColor: 'color-mix(in srgb, var(--primary, #3b82f6) 12%, transparent)'
  },
  '.cm-changedText': {
    backgroundColor: 'color-mix(in srgb, var(--primary, #3b82f6) 26%, transparent)'
  },
  '.cm-deletedChunk': {
    backgroundColor: 'color-mix(in srgb, var(--destructive, #ef4444) 10%, transparent)'
  },
  '.cm-deletedChunk .cm-deletedText, .cm-deletedLine': {
    backgroundColor: 'color-mix(in srgb, var(--destructive, #ef4444) 22%, transparent)'
  },
  '.cm-changedLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--primary, #3b82f6) 30%, transparent)'
  }
});
