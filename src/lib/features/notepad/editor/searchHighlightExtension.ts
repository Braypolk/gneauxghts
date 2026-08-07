import { EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';
import {
  getSearchQuery,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search';
import type {
  EditorController,
  SearchHighlightOptions
} from './types';

const emptySearchHighlightOptions: SearchHighlightOptions = {
  query: '',
  matchCase: false,
  matchWholeWord: false
};

const searchMatchMark = Decoration.mark({ class: 'cm-searchMatch' });
const selectedSearchMatchMark = Decoration.mark({
  class: 'cm-searchMatch cm-searchMatch-selected'
});

function clampPos(
  doc: EditorState['doc'],
  pos: number | null | undefined
) {
  return Math.max(0, Math.min(pos ?? 0, doc.length));
}

export function normalizeSearchQuery(
  query: SearchHighlightOptions | string | null | undefined
): SearchHighlightOptions {
  if (typeof query === 'string' || query == null) {
    return {
      ...emptySearchHighlightOptions,
      query: query?.trim() ?? ''
    };
  }

  return {
    query: query.query.trim(),
    matchCase: query.matchCase,
    matchWholeWord: query.matchWholeWord
  };
}

export function searchQueryFromOptions(options: SearchHighlightOptions) {
  return new SearchQuery({
    search: options.query,
    caseSensitive: options.matchCase,
    wholeWord: options.matchWholeWord,
    literal: true
  });
}

export function createExternalSearchHighlightExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(readonly view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          !getSearchQuery(update.state).eq(getSearchQuery(update.startState))
        ) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView) {
        const query = getSearchQuery(view.state);
        if (!query.valid) {
          return Decoration.none;
        }

        const builder = new RangeSetBuilder<Decoration>();
        for (const {
          from: viewportFrom,
          to: viewportTo
        } of view.visibleRanges) {
          const cursor = query.getCursor(
            view.state,
            viewportFrom,
            viewportTo
          );
          for (
            let result = cursor.next();
            !result.done;
            result = cursor.next()
          ) {
            const { from, to } = result.value;
            const selected = view.state.selection.ranges.some(
              (range) => range.from === from && range.to === to
            );
            builder.add(
              from,
              to,
              selected ? selectedSearchMatchMark : searchMatchMark
            );
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (plugin) => plugin.decorations
    }
  );
}

export function setEditorCurrentSearchHighlightQuery(
  controller: EditorController | null,
  query: SearchHighlightOptions | string | null
) {
  if (!controller) {
    return false;
  }

  const nextQuery = normalizeSearchQuery(query);
  controller.view.dispatch({
    effects: setSearchQuery.of(searchQueryFromOptions(nextQuery))
  });
  return true;
}

export interface FocusEditorSelectionOptions {
  /** When false, keep the current viewport (used when dismissing search). */
  scrollIntoView?: boolean;
}

/** Moves the selection to a document range and takes focus. */
export function focusEditorSelection(
  controller: EditorController | null,
  selection: { anchor: number; head: number } | null | undefined,
  { scrollIntoView = true }: FocusEditorSelectionOptions = {}
) {
  if (!controller || !selection) {
    return false;
  }

  const anchor = clampPos(controller.view.state.doc, selection.anchor);
  const head = clampPos(controller.view.state.doc, selection.head);
  controller.view.dispatch({
    selection: { anchor, head },
    ...(scrollIntoView ? { scrollIntoView: true } : {})
  });
  controller.view.focus();
  return true;
}
