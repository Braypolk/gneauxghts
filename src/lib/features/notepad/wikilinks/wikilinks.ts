import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

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

export interface WikilinkRange {
  from: number;
  to: number;
  rawTarget: string;
}

export function getWikilinkAtPosition(state: EditorState, position: number): WikilinkRange | null {
  const tree = syntaxTree(state);

  for (const bias of [-1, 1] as const) {
    let node: SyntaxNode | null = tree.resolveInner(position, bias);
    while (node && node.name !== 'Wikilink') {
      node = node.parent;
    }

    if (
      node?.name === 'Wikilink' &&
      position >= node.from &&
      position < node.to
    ) {
      return {
        from: node.from,
        to: node.to,
        rawTarget: state.sliceDoc(node.from + 2, node.to - 2)
      };
    }
  }

  return null;
}

function getActiveWikilink(view: EditorView): ActiveWikilink | null {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return null;
  }

  const wikilink = getWikilinkAtPosition(view.state, selection.head);
  if (
    !wikilink ||
    selection.head < wikilink.from + 2 ||
    selection.head > wikilink.to - 2
  ) {
    return null;
  }

  const targetFrom = wikilink.from + 2;
  const targetTo = wikilink.to - 2;
  const cursorCoords = view.coordsAtPos(selection.head);
  if (!cursorCoords) {
    return null;
  }

  return {
    rawTarget: wikilink.rawTarget,
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

function openWikilinkAtPosition(view: EditorView, position: number, config: WikilinkConfig) {
  const wikilink = getWikilinkAtPosition(view.state, position);
  const rawTarget = wikilink?.rawTarget.trim();
  if (!rawTarget) {
    return false;
  }

  resolveCallbacks(view, config).onOpenLink(rawTarget);
  return true;
}

export function createWikilinksExtension(config: WikilinkConfig) {
  return [
    ViewPlugin.fromClass(
      class {
        #destroyed = false;

        constructor(readonly view: EditorView) {
          this.scheduleActiveWikilinkUpdate(view);
        }

        update(update: import('@codemirror/view').ViewUpdate) {
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
        eventHandlers: {
          dblclick: (event, view) => {
            const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position === null) {
              return false;
            }

            if (!openWikilinkAtPosition(view, position, config)) {
              return false;
            }

            event.preventDefault();
            return true;
          }
        }
      }
    ),
    keymap.of([
      {
        key: 'Mod-Enter',
        run: (view) => {
          const selection = view.state.selection.main;
          return selection.empty && openWikilinkAtPosition(view, selection.head, config);
        }
      }
    ]),
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
    })
  ];
}
