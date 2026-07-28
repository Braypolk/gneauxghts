import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view';

export interface PassiveTableRange {
  headerFrom: number;
  delimiterFrom: number;
  bodyFroms: number[];
  endFrom: number;
}

export function isMarkdownTableLine(text: string) {
  const trimmed = text.trim();
  return trimmed.includes('|') && trimmed !== '|';
}

export function isMarkdownTableDelimiterLine(text: string) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(
    text
  );
}

export function collectPassiveTableRanges(doc: {
  lines: number;
  line: (n: number) => { from: number; text: string };
}): PassiveTableRange[] {
  const ranges: PassiveTableRange[] = [];

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const delimiterLine = doc.line(lineNumber);
    if (!isMarkdownTableDelimiterLine(delimiterLine.text)) {
      continue;
    }

    const headerLine = doc.line(lineNumber - 1);
    if (!isMarkdownTableLine(headerLine.text)) {
      continue;
    }

    const bodyFroms: number[] = [];
    let bodyLineNumber = lineNumber + 1;
    while (bodyLineNumber <= doc.lines) {
      const bodyLine = doc.line(bodyLineNumber);
      if (!isMarkdownTableLine(bodyLine.text)) {
        break;
      }
      bodyFroms.push(bodyLine.from);
      bodyLineNumber += 1;
    }

    const endFrom =
      bodyFroms.length > 0
        ? bodyFroms[bodyFroms.length - 1]!
        : delimiterLine.from;

    ranges.push({
      headerFrom: headerLine.from,
      delimiterFrom: delimiterLine.from,
      bodyFroms,
      endFrom
    });

    lineNumber = bodyLineNumber - 1;
  }

  return ranges;
}

function buildPassiveTableDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = collectPassiveTableRanges(view.state.doc);

  for (const range of ranges) {
    builder.add(
      range.headerFrom,
      range.headerFrom,
      Decoration.line({
        class:
          'gn-markdown-table-line gn-markdown-table-header gn-markdown-table-line-start'
      })
    );
    builder.add(
      range.delimiterFrom,
      range.delimiterFrom,
      Decoration.line({
        class: [
          'gn-markdown-table-line',
          'gn-markdown-table-delimiter',
          range.endFrom === range.delimiterFrom
            ? 'gn-markdown-table-line-end'
            : ''
        ]
          .filter(Boolean)
          .join(' ')
      })
    );

    for (const bodyFrom of range.bodyFroms) {
      builder.add(
        bodyFrom,
        bodyFrom,
        Decoration.line({
          class: [
            'gn-markdown-table-line',
            range.endFrom === bodyFrom ? 'gn-markdown-table-line-end' : ''
          ]
            .filter(Boolean)
            .join(' ')
        })
      );
    }
  }

  return builder.finish();
}

function tableGroupForRow(source: HTMLElement) {
  const content = source.parentElement;
  if (!content) return null;

  const rows = [
    ...content.querySelectorAll<HTMLElement>('.gn-markdown-table-line')
  ];
  const groups: HTMLElement[][] = [];
  let current: HTMLElement[] = [];
  for (const row of rows) {
    const previous = current[current.length - 1];
    if (!previous || previous.nextElementSibling === row) {
      current.push(row);
    } else {
      groups.push(current);
      current = [row];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.find((candidate) => candidate.includes(source)) ?? null;
}

export function syncTableRowScroll(source: HTMLElement) {
  const group = tableGroupForRow(source);
  if (!group) return;

  const left = source.scrollLeft;
  for (const row of group) {
    if (row !== source && row.scrollLeft !== left) {
      row.scrollLeft = left;
    }
  }
}

function findTableLineElement(
  view: EditorView,
  pos: number
): HTMLElement | null {
  const dom = view.domAtPos(pos);
  let node: Node | null = dom.node;
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }
  while (node && node !== view.contentDOM) {
    if (
      node instanceof HTMLElement &&
      node.classList.contains('gn-markdown-table-line')
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function ensureTableCaretVisible(view: EditorView) {
  const head = view.state.selection.main.head;
  const row = findTableLineElement(view, head);
  if (!row) return;

  const coords = view.coordsAtPos(head);
  if (!coords) return;

  const visible = row.getBoundingClientRect();
  const pad = 24;
  if (coords.left > visible.right - 8) {
    row.scrollLeft += coords.left - visible.right + pad;
    syncTableRowScroll(row);
  } else if (coords.left < visible.left + 8) {
    row.scrollLeft -= visible.left - coords.left + pad;
    syncTableRowScroll(row);
  }
}

export function createPassiveTableExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      #onScroll: (event: Event) => void;
      #dom: HTMLElement;

      constructor(view: EditorView) {
        this.decorations = buildPassiveTableDecorations(view);
        this.#dom = view.dom;
        this.#onScroll = (event: Event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (!target.classList.contains('gn-markdown-table-line')) return;
          syncTableRowScroll(target);
        };
        this.#dom.addEventListener('scroll', this.#onScroll, true);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildPassiveTableDecorations(update.view);
        }
        if (update.selectionSet || update.docChanged) {
          queueMicrotask(() => ensureTableCaretVisible(update.view));
        }
      }

      destroy() {
        this.#dom.removeEventListener('scroll', this.#onScroll, true);
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}
