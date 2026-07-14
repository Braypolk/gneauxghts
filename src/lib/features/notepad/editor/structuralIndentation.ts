import { indentLess, indentMore } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

type IndentDirection = 'indent' | 'outdent';

export interface IndentationChange {
  from: number;
  to: number;
  insert: string;
}

export type ListIndentationPlan =
  | { kind: 'not-list' }
  | { kind: 'invalid' }
  | { kind: 'changes'; changes: IndentationChange[] };

interface ListItemInfo {
  key: string;
  parentItemKey: string | null;
  startLine: number;
  endLine: number;
  indentColumn: number;
  contentColumn: number;
}

interface ListItemGroup {
  items: ListItemInfo[];
}

const LIST_PREFIX_RE = /^([\t ]*)(?:[-+*]|\d{1,9}[.)])([\t ]+)/;

function nodeKey(node: SyntaxNode): string {
  return `${node.name}:${node.from}:${node.to}`;
}

function ancestorNamed(node: SyntaxNode | null, name: string): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === name) {
      return current;
    }
  }
  return null;
}

function indentationColumn(text: string, tabSize: number): number {
  let column = 0;
  for (const character of text) {
    if (character === '\t') {
      column += tabSize - (column % tabSize);
    } else {
      column += 1;
    }
  }
  return column;
}

function collectListItems(state: EditorState): ListItemInfo[] {
  const items: ListItemInfo[] = [];

  syntaxTree(state).iterate({
    enter(nodeRef) {
      if (nodeRef.name !== 'ListItem') {
        return;
      }

      const node = nodeRef.node;
      const parentList = node.parent;
      if (!parentList || (parentList.name !== 'BulletList' && parentList.name !== 'OrderedList')) {
        return;
      }

      const line = state.doc.lineAt(node.from);
      const prefix = line.text.match(LIST_PREFIX_RE);
      if (!prefix) {
        return;
      }

      const parentItem = ancestorNamed(parentList.parent, 'ListItem');
      items.push({
        key: nodeKey(node),
        parentItemKey: parentItem ? nodeKey(parentItem) : null,
        startLine: line.number,
        endLine: state.doc.lineAt(Math.max(node.from, node.to - 1)).number,
        indentColumn: indentationColumn(prefix[1], state.tabSize),
        contentColumn: indentationColumn(prefix[0], state.tabSize)
      });
    }
  });

  return items;
}

function selectedLineNumbers(state: EditorState): number[] {
  const selection = state.selection.main;
  const first = state.doc.lineAt(selection.from).number;
  let lastLine = state.doc.lineAt(selection.to);

  if (
    selection.to > selection.from &&
    selection.to === lastLine.from &&
    lastLine.number > first
  ) {
    lastLine = state.doc.line(lastLine.number - 1);
  }

  return Array.from({ length: lastLine.number - first + 1 }, (_, index) => first + index);
}

function innermostItemForLine(items: ListItemInfo[], lineNumber: number): ListItemInfo | null {
  let match: ListItemInfo | null = null;
  for (const item of items) {
    if (item.startLine <= lineNumber && item.endLine >= lineNumber) {
      if (!match || item.startLine >= match.startLine && item.endLine <= match.endLine) {
        match = item;
      }
    }
  }
  return match;
}

function hasSelectedAncestor(
  item: ListItemInfo,
  selectedKeys: ReadonlySet<string>,
  byKey: ReadonlyMap<string, ListItemInfo>
): boolean {
  let parentKey = item.parentItemKey;
  while (parentKey) {
    if (selectedKeys.has(parentKey)) {
      return true;
    }
    parentKey = byKey.get(parentKey)?.parentItemKey ?? null;
  }
  return false;
}

function groupSelectedRoots(roots: ListItemInfo[]): ListItemGroup[] {
  const sorted = [...roots].sort((a, b) => a.startLine - b.startLine);
  const groups: ListItemGroup[] = [];
  for (const item of sorted) {
    const current = groups.at(-1);
    const previous = current?.items.at(-1);
    if (
      current &&
      previous &&
      item.parentItemKey === previous.parentItemKey &&
      item.indentColumn === previous.indentColumn &&
      item.startLine === previous.endLine + 1
    ) {
      current.items.push(item);
    } else {
      groups.push({ items: [item] });
    }
  }
  return groups;
}

function onlyBlankLinesBetween(state: EditorState, fromLine: number, toLine: number): boolean {
  for (let lineNumber = fromLine + 1; lineNumber < toLine; lineNumber += 1) {
    if (state.doc.line(lineNumber).text.trim() !== '') {
      return false;
    }
  }
  return true;
}

function previousLogicalSibling(
  state: EditorState,
  items: ListItemInfo[],
  item: ListItemInfo
): ListItemInfo | null {
  let previous: ListItemInfo | null = null;
  for (const candidate of items) {
    if (
      candidate.parentItemKey === item.parentItemKey &&
      candidate.indentColumn === item.indentColumn &&
      candidate.endLine < item.startLine &&
      onlyBlankLinesBetween(state, candidate.endLine, item.startLine) &&
      (!previous || candidate.endLine > previous.endLine)
    ) {
      previous = candidate;
    }
  }
  return previous;
}

function lineIndentChange(
  state: EditorState,
  lineNumber: number,
  delta: number
): IndentationChange | null {
  const line = state.doc.line(lineNumber);
  if (line.text.trim() === '') {
    return null;
  }

  const whitespace = line.text.match(/^[\t ]*/)?.[0] ?? '';
  const currentColumn = indentationColumn(whitespace, state.tabSize);
  const nextColumn = Math.max(0, currentColumn + delta);
  const insert = ' '.repeat(nextColumn);
  if (insert === whitespace) {
    return null;
  }

  return { from: line.from, to: line.from + whitespace.length, insert };
}

export function planListIndentation(
  state: EditorState,
  direction: IndentDirection
): ListIndentationPlan {
  const items = collectListItems(state);
  const selectedItems: ListItemInfo[] = [];

  for (const lineNumber of selectedLineNumbers(state)) {
    const item = innermostItemForLine(items, lineNumber);
    if (!item) {
      return { kind: 'not-list' };
    }
    if (!selectedItems.some((selected) => selected.key === item.key)) {
      selectedItems.push(item);
    }
  }

  if (selectedItems.length === 0) {
    return { kind: 'not-list' };
  }

  const byKey = new Map(items.map((item) => [item.key, item]));
  const selectedKeys = new Set(selectedItems.map((item) => item.key));
  const roots = selectedItems.filter((item) => !hasSelectedAncestor(item, selectedKeys, byKey));
  const groups = groupSelectedRoots(roots);

  const changes: IndentationChange[] = [];
  for (const group of groups) {
    const firstItem = group.items[0];
    if (!firstItem) {
      return { kind: 'invalid' };
    }
    let targetColumn: number;

    if (direction === 'indent') {
      const previousSibling = previousLogicalSibling(state, items, firstItem);
      if (!previousSibling) {
        return { kind: 'invalid' };
      }
      targetColumn = previousSibling.contentColumn;
    } else {
      const parentItem = byKey.get(firstItem.parentItemKey ?? '');
      if (!parentItem) {
        return { kind: 'invalid' };
      }
      targetColumn = parentItem.indentColumn;
    }

    for (const item of group.items) {
      const delta = targetColumn - item.indentColumn;
      if (direction === 'indent' ? delta <= 0 : delta >= 0) {
        return { kind: 'invalid' };
      }
      for (let lineNumber = item.startLine; lineNumber <= item.endLine; lineNumber += 1) {
        const change = lineIndentChange(state, lineNumber, delta);
        if (change) {
          changes.push(change);
        }
      }
    }
  }

  changes.sort((a, b) => a.from - b.from);
  return changes.length > 0 ? { kind: 'changes', changes } : { kind: 'invalid' };
}

function applyEditorIndentation(view: EditorView, direction: IndentDirection): boolean {
  const plan = planListIndentation(view.state, direction);
  if (plan.kind === 'not-list') {
    return direction === 'indent' ? indentMore(view) : indentLess(view);
  }
  if (plan.kind === 'invalid') {
    return true;
  }

  view.dispatch({ changes: plan.changes });
  return true;
}

export function indentEditorSelection(view: EditorView): boolean {
  return applyEditorIndentation(view, 'indent');
}

export function outdentEditorSelection(view: EditorView): boolean {
  return applyEditorIndentation(view, 'outdent');
}
