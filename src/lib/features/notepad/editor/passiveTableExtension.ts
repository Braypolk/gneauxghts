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

export interface PassiveTableLineSpec {
  from: number;
  className: string;
  groupId: string;
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
      // Two tables may be adjacent with no blank line. If this table-looking
      // row is immediately followed by a delimiter, it is the next header.
      if (
        bodyLineNumber < doc.lines &&
        isMarkdownTableDelimiterLine(doc.line(bodyLineNumber + 1).text)
      ) {
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

export function buildPassiveTableDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const spec of collectPassiveTableLineSpecs(view.state.doc)) {
    builder.add(
      spec.from,
      spec.from,
      Decoration.line({
        class: spec.className,
        attributes: { 'data-gn-table-group': spec.groupId }
      })
    );
  }

  return builder.finish();
}

export function collectPassiveTableLineSpecs(doc: {
  lines: number;
  line: (n: number) => { from: number; text: string };
}): PassiveTableLineSpec[] {
  return collectPassiveTableRanges(doc).flatMap((range, groupIndex) => {
    const groupId = String(groupIndex);
    return [
      {
        from: range.headerFrom,
        className:
          'gn-markdown-table-line gn-markdown-table-header gn-markdown-table-line-start',
        groupId
      },
      {
        from: range.delimiterFrom,
        className: [
          'gn-markdown-table-line',
          'gn-markdown-table-delimiter',
          range.endFrom === range.delimiterFrom
            ? 'gn-markdown-table-line-end'
            : ''
        ]
          .filter(Boolean)
          .join(' '),
        groupId
      },
      ...range.bodyFroms.map((from) => ({
        from,
        className: [
          'gn-markdown-table-line',
          range.endFrom === from ? 'gn-markdown-table-line-end' : ''
        ]
          .filter(Boolean)
          .join(' '),
        groupId
      }))
    ];
  });
}

function tableGroupForRow(source: HTMLElement) {
  const content = source.parentElement;
  if (!content) return null;

  const groupId = source.dataset.gnTableGroup;
  if (groupId !== undefined) {
    return [
      ...content.querySelectorAll<HTMLElement>('.gn-markdown-table-line')
    ].filter((row) => row.dataset.gnTableGroup === groupId);
  }

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

export interface TableCaretScrollInput {
  scrollLeft: number;
  rowLeft: number;
  rowRight: number;
  caretLeft: number;
  padding?: number;
}

export function nextTableRowScrollLeft({
  scrollLeft,
  rowLeft,
  rowRight,
  caretLeft,
  padding = 24
}: TableCaretScrollInput) {
  if (caretLeft > rowRight - 8) {
    return Math.max(0, scrollLeft + caretLeft - rowRight + padding);
  }
  if (caretLeft < rowLeft + 8) {
    return Math.max(0, scrollLeft - (rowLeft - caretLeft + padding));
  }
  return scrollLeft;
}

interface TableCaretMeasurement {
  row: HTMLElement;
  scrollLeft: number;
}

function measureTableCaret(view: EditorView): TableCaretMeasurement | null {
  const head = view.state.selection.main.head;
  const row = findTableLineElement(view, head);
  if (!row) return null;

  const coords = view.coordsAtPos(head);
  if (!coords) return null;

  const visible = row.getBoundingClientRect();
  return {
    row,
    scrollLeft: nextTableRowScrollLeft({
      scrollLeft: row.scrollLeft,
      rowLeft: visible.left,
      rowRight: visible.right,
      caretLeft: coords.left
    })
  };
}

export function createPassiveTableExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      #onScroll: (event: Event) => void;
      #dom: HTMLElement;
      #destroyed = false;
      #caretMeasureQueued = false;

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
        this.#scheduleCaretVisibility(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildPassiveTableDecorations(update.view);
        }
        if (
          update.selectionSet ||
          update.docChanged ||
          update.viewportChanged
        ) {
          this.#scheduleCaretVisibility(update.view);
        }
      }

      #scheduleCaretVisibility(view: EditorView) {
        if (this.#destroyed || this.#caretMeasureQueued) return;
        this.#caretMeasureQueued = true;
        view.requestMeasure({
          read: () => measureTableCaret(view),
          write: (measurement) => {
            this.#caretMeasureQueued = false;
            if (this.#destroyed || !measurement) return;
            if (measurement.row.scrollLeft !== measurement.scrollLeft) {
              measurement.row.scrollLeft = measurement.scrollLeft;
              syncTableRowScroll(measurement.row);
            }
          }
        });
      }

      destroy() {
        this.#destroyed = true;
        this.#dom.removeEventListener('scroll', this.#onScroll, true);
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}
