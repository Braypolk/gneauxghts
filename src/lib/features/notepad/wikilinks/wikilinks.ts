import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

const WIKILINK_PATTERN = /\[\[([^\[\]\n]+?)\]\]/g;
const FENCE_PATTERN = /^\s*(```+|~~~+)/;

interface WikilinkConfig {
  resolveCallbacks: (view: EditorView) => Partial<WikilinkCallbacks> | null | undefined;
}

interface WikilinkCallbacks {
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
}

export interface ActiveWikilink {
  rawTarget: string;
  targetFrom: number;
  targetTo: number;
  left: number;
  top: number;
  bottom: number;
}

const defaultWikilinkCallbacks: WikilinkCallbacks = {
  onOpenLink: () => {},
  onActiveWikilinkChange: () => {}
};

function lineStarts(text: string) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && index + 1 <= text.length) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function isOffsetInsideCodeFence(text: string, offset: number, starts = lineStarts(text)) {
  let insideFence = false;

  for (const start of starts) {
    if (start > offset) {
      break;
    }

    const end = text.indexOf('\n', start);
    const line = text.slice(start, end === -1 ? text.length : end);
    if (FENCE_PATTERN.test(line)) {
      insideFence = !insideFence;
    }
  }

  return insideFence;
}

function buildWikilinkDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  const starts = lineStarts(text);

  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const index = match.index ?? -1;
    const rawTarget = match[1]?.trim();
    if (index < 0 || !rawTarget || isOffsetInsideCodeFence(text, index, starts)) {
      continue;
    }

    builder.add(
      index,
      index + match[0].length,
      Decoration.mark({
        class: 'gn-wikilink',
        attributes: {
          'data-wikilink-target': rawTarget
        }
      })
    );
  }

  return builder.finish();
}

function findWikilinkElement(target: EventTarget | null) {
  if (target instanceof HTMLElement) {
    return target.closest<HTMLElement>('.gn-wikilink');
  }

  if (target instanceof Text) {
    return target.parentElement?.closest<HTMLElement>('.gn-wikilink') ?? null;
  }

  return null;
}

function getActiveWikilink(view: EditorView): ActiveWikilink | null {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return null;
  }

  const text = view.state.doc.toString();
  if (isOffsetInsideCodeFence(text, selection.head)) {
    return null;
  }

  const line = view.state.doc.lineAt(selection.head);
  const lineText = line.text;
  const cursorOffset = selection.head - line.from;
  const start = lineText.lastIndexOf('[[', cursorOffset);
  if (start < 0 || cursorOffset < start + 2) {
    return null;
  }

  const end = lineText.indexOf(']]', start + 2);
  if (end < 0 || cursorOffset > end) {
    return null;
  }

  const targetFrom = line.from + start + 2;
  const targetTo = line.from + end;
  const cursorCoords = view.coordsAtPos(selection.head);
  if (!cursorCoords) {
    return null;
  }

  return {
    rawTarget: lineText.slice(start + 2, end),
    targetFrom,
    targetTo,
    left: cursorCoords.left,
    top: cursorCoords.top,
    bottom: cursorCoords.bottom
  };
}

function resolveCallbacks(view: EditorView, config: WikilinkConfig): WikilinkCallbacks {
  return {
    ...defaultWikilinkCallbacks,
    ...config.resolveCallbacks(view)
  };
}

export function createWikilinksExtension(config: WikilinkConfig) {
  return [
    ViewPlugin.fromClass(
      class {
        decorations;
        #destroyed = false;

        constructor(readonly view: EditorView) {
          this.decorations = buildWikilinkDecorations(view);
          this.scheduleActiveWikilinkUpdate(view);
        }

        update(update: import('@codemirror/view').ViewUpdate) {
          if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = buildWikilinkDecorations(update.view);
          }

          if (update.docChanged || update.selectionSet) {
            this.scheduleActiveWikilinkUpdate(update.view);
          }
        }

        destroy() {
          this.#destroyed = true;
          resolveCallbacks(this.view, config).onActiveWikilinkChange(null);
        }

        private scheduleActiveWikilinkUpdate(view: EditorView) {
          view.requestMeasure({
            read: () => getActiveWikilink(view),
            write: (activeWikilink) => {
              if (this.#destroyed) {
                return;
              }
              resolveCallbacks(view, config).onActiveWikilinkChange(activeWikilink);
            }
          });
        }
      },
      {
        decorations: (value) => value.decorations
      }
    ),
    EditorView.inputHandler.of((view, from, to, text, insert) => {
      if (text !== '[' || from !== to) {
        return false;
      }

      const docText = view.state.doc.toString();
      if (isOffsetInsideCodeFence(docText, from)) {
        return false;
      }

      const previousCharacter = view.state.sliceDoc(Math.max(0, from - 1), from);
      if (previousCharacter !== '[') {
        return false;
      }

      const nextCharacters = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2));
      if (nextCharacters === ']]') {
        return false;
      }

      view.dispatch(
        view.state.update({
          changes: { from, to, insert: '[]]' },
          selection: { anchor: from + 1 }
        })
      );
      return true;
    }),
    EditorView.domEventHandlers({
      click: (event, view) => {
        const wikilinkElement = findWikilinkElement(event.target);
        const rawTarget = wikilinkElement?.dataset.wikilinkTarget?.trim();
        if (!rawTarget) {
          return false;
        }

        event.preventDefault();
        resolveCallbacks(view, config).onOpenLink(rawTarget);
        return true;
      }
    })
  ];
}
