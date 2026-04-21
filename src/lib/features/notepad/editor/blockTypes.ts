import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export interface EditorMenuOption {
  id: string;
  label: string;
}

export interface EditorMenuGroup {
  key: string;
  label: string;
  items: readonly EditorMenuOption[];
}

export type BlockTypeId =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'code'
  | 'divider'
  | 'wikilink';

export interface BlockDescriptor {
  from: number;
  to: number;
  moveTo: number;
  startLine: number;
  endLine: number;
  typeId: BlockTypeId;
  indent: number;
}

const headingPattern = /^(#{1,6})\s+/;
const quotePattern = /^\s*>\s?/;
const unorderedListPattern = /^(\s*)([-+*])\s+(\[[ xX]\]\s+)?/;
const orderedListPattern = /^(\s*)(\d+\.)\s+(\[[ xX]\]\s+)?/;
const taskOnlyPattern = /^(\s*)([-+*])\s+\[[ xX]\]\s+/;
const hrPattern = /^\s*(?:---|\*\*\*|___)\s*$/;
const fencePattern = /^\s*(```+|~~~+)/;

const wikilinkSlashIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M10 9H6.75A3.75 3.75 0 1 0 6.75 16.5H10" />
    <path d="M14 15H17.25A3.75 3.75 0 1 0 17.25 7.5H14" />
    <path d="M8.5 12h7" />
  </svg>
`;

export const baseTextMenuItems = [
  { id: 'paragraph', label: 'Text' },
  { id: 'heading1', label: 'Heading 1' },
  { id: 'heading2', label: 'Heading 2' },
  { id: 'heading3', label: 'Heading 3' },
  { id: 'heading4', label: 'Heading 4' },
  { id: 'heading5', label: 'Heading 5' },
  { id: 'heading6', label: 'Heading 6' },
  { id: 'quote', label: 'Quote' }
] as const satisfies readonly EditorMenuOption[];

export const baseListMenuItems = [
  { id: 'bulletList', label: 'Bullet List' },
  { id: 'orderedList', label: 'Ordered List' },
  { id: 'taskList', label: 'Task List' }
] as const satisfies readonly EditorMenuOption[];

export const baseAdvancedMenuItems = [{ id: 'code', label: 'Code' }] as const satisfies readonly EditorMenuOption[];

export const slashMenuGroups: readonly EditorMenuGroup[] = [
  {
    key: 'text',
    label: 'Text',
    items: [
      ...baseTextMenuItems,
      { id: 'divider', label: 'Divider' },
      { id: 'wikilink', label: 'Wikilink' }
    ]
  },
  {
    key: 'list',
    label: 'List',
    items: baseListMenuItems
  },
  {
    key: 'advanced',
    label: 'Advanced',
    items: baseAdvancedMenuItems
  }
];

export const blockTypeMenuGroups: readonly EditorMenuGroup[] = [
  {
    key: 'text',
    label: 'Text',
    items: baseTextMenuItems
  },
  {
    key: 'list',
    label: 'List',
    items: baseListMenuItems
  },
  {
    key: 'advanced',
    label: 'Advanced',
    items: baseAdvancedMenuItems
  }
];

export const slashMenuOptionIds = new Set(
  slashMenuGroups.flatMap((group) => group.items.map((item) => item.id))
);

export const blockTypeIcons: Record<string, string> = {
  paragraph: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 5.5C5 6.33 5.67 7 6.5 7H10.5V17.5C10.5 18.33 11.17 19 12 19C12.83 19 13.5 18.33 13.5 17.5V7H17.5C18.33 7 19 6.33 19 5.5C19 4.67 18.33 4 17.5 4H6.5C5.67 4 5 4.67 5 5.5Z"/></svg>`,
  heading1: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM12 17H14V7H10V9H12V17Z"/></svg>`,
  heading2: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15H11V13H13C14.1 13 15 12.11 15 11V9C15 7.89 14.1 7 13 7H9V9H13V11H11C9.9 11 9 11.89 9 13V17H15V15Z"/></svg>`,
  heading3: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15V13.5C15 12.67 14.33 12 13.5 12C14.33 12 15 11.33 15 10.5V9C15 7.89 14.1 7 13 7H9V9H13V11H11V13H13V15H9V17H13C14.1 17 15 16.11 15 15Z"/></svg>`,
  heading4: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19.04 3H5.04004C3.94004 3 3.04004 3.9 3.04004 5V19C3.04004 20.1 3.94004 21 5.04004 21H19.04C20.14 21 21.04 20.1 21.04 19V5C21.04 3.9 20.14 3 19.04 3ZM19.04 19H5.04004V5H19.04V19ZM13.04 17H15.04V7H13.04V11H11.04V7H9.04004V13H13.04V17Z"/></svg>`,
  heading5: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15V13C15 11.89 14.1 11 13 11H11V9H15V7H9V13H13V15H9V17H13C14.1 17 15 16.11 15 15Z"/></svg>`,
  heading6: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M11 17H13C14.1 17 15 16.11 15 15V13C15 11.89 14.1 11 13 11H11V9H15V7H11C9.9 7 9 7.89 9 9V15C9 16.11 9.9 17 11 17ZM11 13H13V15H11V13ZM19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19Z"/></svg>`,
  quote: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7.17 17C7.68 17 8.15 16.71 8.37 16.26L9.79 13.42C9.93 13.14 10 12.84 10 12.53V8C10 7.45 9.55 7 9 7H5C4.45 7 4 7.45 4 8V12C4 12.55 4.45 13 5 13H7L5.97 15.06C5.52 15.95 6.17 17 7.17 17ZM17.17 17C17.68 17 18.15 16.71 18.37 16.26L19.79 13.42C19.93 13.14 20 12.84 20 12.53V8C20 7.45 19.55 7 19 7H15C14.45 7 14 7.45 14 8V12C14 12.55 14.45 13 15 13H17L15.97 15.06C15.52 15.95 16.17 17 17.17 17Z"/></svg>`,
  divider: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 11H20V13H4V11Z"/></svg>`,
  bulletList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 10.5C3.17 10.5 2.5 11.17 2.5 12C2.5 12.83 3.17 13.5 4 13.5C4.83 13.5 5.5 12.83 5.5 12C5.5 11.17 4.83 10.5 4 10.5ZM4 4.5C3.17 4.5 2.5 5.17 2.5 6C2.5 6.83 3.17 7.5 4 7.5C4.83 7.5 5.5 6.83 5.5 6C5.5 5.17 4.83 4.5 4 4.5ZM4 16.5C3.17 16.5 2.5 17.18 2.5 18C2.5 18.82 3.18 19.5 4 19.5C4.82 19.5 5.5 18.82 5.5 18C5.5 17.18 4.83 16.5 4 16.5ZM8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19ZM8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13ZM7 6C7 6.55 7.45 7 8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6Z"/></svg>`,
  orderedList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6C7 6.55 7.45 7 8 7ZM20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17ZM20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11ZM4.5 16H2.5C2.22 16 2 16.22 2 16.5C2 16.78 2.22 17 2.5 17H4V17.5H3.5C3.22 17.5 3 17.72 3 18C3 18.28 3.22 18.5 3.5 18.5H4V19H2.5C2.22 19 2 19.22 2 19.5C2 19.78 2.22 20 2.5 20H4.5C4.78 20 5 19.78 5 19.5V16.5C5 16.22 4.78 16 4.5 16ZM2.5 5H3V7.5C3 7.78 3.22 8 3.5 8C3.78 8 4 7.78 4 7.5V4.5C4 4.22 3.78 4 3.5 4H2.5C2.22 4 2 4.22 2 4.5C2 4.78 2.22 5 2.5 5ZM4.5 10H2.5C2.22 10 2 10.22 2 10.5C2 10.78 2.22 11 2.5 11H3.8L2.12 12.96C2.04 13.05 2 13.17 2 13.28V13.5C2 13.78 2.22 14 2.5 14H4.5C4.78 14 5 13.78 5 13.5C5 13.22 4.78 13 4.5 13H3.2L4.88 11.04C4.96 10.95 5 10.83 5 10.72V10.5C5 10.22 4.78 10 4.5 10Z"/></svg>`,
  taskList: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5.67 16.34L9.39 12.62C9.54 12.47 9.72 12.39 9.92 12.4C10.12 12.4 10.3 12.48 10.45 12.63C10.58 12.78 10.65 12.96 10.65 13.16C10.65 13.36 10.58 13.54 10.45 13.69L6.33 17.82C6.15 18 5.94 18.09 5.69 18.09C5.45 18.09 5.24 18 5.06 17.82L3.02 15.78C2.88 15.64 2.81 15.46 2.81 15.25C2.82 15.04 2.89 14.87 3.03 14.73C3.17 14.59 3.34 14.52 3.55 14.52C3.76 14.52 3.93 14.59 4.07 14.73L5.67 16.34ZM5.67 8.72L9.39 5C9.54 4.85 9.72 4.78 9.92 4.78C10.12 4.78 10.3 4.86 10.45 5.02C10.58 5.17 10.65 5.34 10.65 5.54C10.65 5.75 10.58 5.92 10.45 6.07L6.33 10.2C6.15 10.39 5.94 10.48 5.69 10.48C5.45 10.48 5.24 10.39 5.06 10.2L3.02 8.16C2.88 8.02 2.81 7.85 2.81 7.64C2.82 7.43 2.89 7.25 3.03 7.12C3.17 6.98 3.34 6.91 3.55 6.91C3.76 6.91 3.93 6.98 4.07 7.12L5.67 8.72ZM13.76 16.56C13.55 16.56 13.37 16.49 13.23 16.34C13.08 16.2 13.01 16.02 13.01 15.81C13.01 15.6 13.08 15.42 13.23 15.27C13.37 15.13 13.55 15.06 13.76 15.06H20.76C20.97 15.06 21.15 15.13 21.29 15.27C21.44 15.42 21.51 15.6 21.51 15.81C21.51 16.02 21.44 16.2 21.29 16.34C21.15 16.49 20.97 16.56 20.76 16.56H13.76ZM13.76 8.94C13.55 8.94 13.37 8.87 13.23 8.73C13.08 8.58 13.01 8.41 13.01 8.19C13.01 7.98 13.08 7.8 13.23 7.66C13.37 7.51 13.55 7.44 13.76 7.44H20.76C20.97 7.44 21.15 7.51 21.29 7.66C21.44 7.8 21.51 7.98 21.51 8.19C21.51 8.41 21.44 8.58 21.29 8.73C21.15 8.87 20.97 8.94 20.76 8.94H13.76Z"/></svg>`,
  code: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6ZM14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6Z"/></svg>`,
  wikilink: wikilinkSlashIcon
};

interface LineInfo {
  number: number;
  from: number;
  to: number;
  text: string;
}

function getLineInfo(state: EditorState, number: number): LineInfo {
  const line = state.doc.line(number);
  return {
    number,
    from: line.from,
    to: line.to,
    text: line.text
  };
}

function countIndent(text: string) {
  const match = text.match(/^\s*/);
  return match?.[0]?.length ?? 0;
}

function isBlank(text: string) {
  return text.trim() === '';
}

function matchesList(text: string) {
  return unorderedListPattern.test(text) || orderedListPattern.test(text);
}

function matchesTask(text: string) {
  return taskOnlyPattern.test(text);
}

function listKind(text: string): BlockTypeId {
  if (matchesTask(text)) return 'taskList';
  if (orderedListPattern.test(text)) return 'orderedList';
  return 'bulletList';
}

function isTableLine(text: string) {
  const trimmed = text.trim();
  return trimmed.includes('|') && trimmed !== '|';
}

function isTableDelimiterLine(text: string) {
  return /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(text);
}

function stripListMarker(text: string) {
  return text.replace(/^(\s*)(?:[-+*]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '$1');
}

function stripQuote(text: string) {
  return text.replace(/^\s*>\s?/, '');
}

function lineContentRange(state: EditorState, lineNumber: number) {
  const line = state.doc.line(lineNumber);
  return {
    from: line.from,
    to: line.to,
    moveTo: lineNumber < state.doc.lines ? state.doc.line(lineNumber + 1).from : line.to
  };
}

function detectLineBlockType(text: string): BlockTypeId {
  if (isBlank(text)) return 'paragraph';

  const headingMatch = text.match(headingPattern);
  if (headingMatch) {
    return `heading${headingMatch[1].length}` as BlockTypeId;
  }

  if (fencePattern.test(text)) return 'code';
  if (quotePattern.test(text)) return 'quote';
  if (matchesList(text)) return listKind(text);
  if (hrPattern.test(text.trim())) return 'divider';
  return 'paragraph';
}

function describeBlankLineBlock(state: EditorState, lineNumber: number): BlockDescriptor {
  const { from, to, moveTo } = lineContentRange(state, lineNumber);

  return {
    from,
    to,
    moveTo,
    startLine: lineNumber,
    endLine: lineNumber,
    typeId: 'paragraph',
    indent: 0
  };
}

function findFenceEnd(state: EditorState, startLine: number, fenceText: string) {
  for (let lineNo = startLine + 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo).text;
    if (line.trim().startsWith(fenceText)) {
      return lineNo;
    }
  }
  return startLine;
}

function findListItemEnd(state: EditorState, startLine: number) {
  const startText = state.doc.line(startLine).text;
  const baseIndent = countIndent(startText);
  let endLine = startLine;

  for (let lineNo = startLine + 1; lineNo <= state.doc.lines; lineNo += 1) {
    const text = state.doc.line(lineNo).text;
    if (isBlank(text)) {
      endLine = lineNo;
      continue;
    }

    const indent = countIndent(text);
    const listHere = matchesList(text);
    if (indent < baseIndent) {
      break;
    }
    if (indent === baseIndent && listHere) {
      break;
    }
    if (indent === 0 && !listHere && baseIndent === 0) {
      break;
    }
    endLine = lineNo;
  }

  while (endLine > startLine && isBlank(state.doc.line(endLine).text)) {
    endLine -= 1;
  }

  return endLine;
}

function describeBlockStartingAt(state: EditorState, startLine: number): BlockDescriptor {
  const start = getLineInfo(state, startLine);
  const text = start.text;
  const { from, to, moveTo } = lineContentRange(state, startLine);

  return {
    from,
    to,
    moveTo,
    startLine,
    endLine: startLine,
    typeId: detectLineBlockType(text),
    indent: countIndent(text)
  };
}

export function listBlocks(state: EditorState) {
  const blocks: BlockDescriptor[] = [];
  let lineNo = 1;

  while (lineNo <= state.doc.lines) {
    const block = describeBlockStartingAt(state, lineNo);
    blocks.push(block);
    lineNo += 1;
  }

  return blocks;
}

export function describeBlockAt(state: EditorState, pos: number) {
  const line = state.doc.lineAt(Math.max(0, Math.min(pos, state.doc.length)));
  return describeBlockStartingAt(state, line.number);
}

function applySpec(view: EditorView, spec: TransactionSpec) {
  view.dispatch(spec);
  view.focus();
  return true;
}

function replaceBlock(view: EditorView, block: BlockDescriptor, insert: string, anchor?: number) {
  return applySpec(view, {
    changes: { from: block.from, to: block.to, insert },
    selection: { anchor: anchor ?? block.from + insert.length, head: anchor ?? block.from + insert.length },
    scrollIntoView: true
  });
}

function normalizeToParagraphLines(text: string) {
  const lines = text.split('\n');

  if (lines.length >= 2 && fencePattern.test(lines[0] ?? '') && fencePattern.test(lines.at(-1) ?? '')) {
    return lines.slice(1, -1);
  }

  return lines.map((line) => stripListMarker(stripQuote(line)).replace(headingPattern, ''));
}

function toHeading(text: string, level: number) {
  const lines = normalizeToParagraphLines(text);
  const [first = '', ...rest] = lines;
  return [`${'#'.repeat(level)} ${first.trim()}`, ...rest].join('\n');
}

function toParagraph(text: string) {
  return normalizeToParagraphLines(text).join('\n');
}

function toQuote(text: string) {
  return normalizeToParagraphLines(text)
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
}

function toCode(text: string) {
  const lines = normalizeToParagraphLines(text);
  return ['```', ...lines, '```'].join('\n');
}

function toList(text: string, kind: 'bulletList' | 'orderedList' | 'taskList') {
  const lines = normalizeToParagraphLines(text);
  if (lines.length === 0) {
    return kind === 'orderedList' ? '1. ' : kind === 'taskList' ? '- [ ] ' : '- ';
  }

  const first = lines[0] ?? '';
  const prefix =
    kind === 'orderedList' ? '1. ' : kind === 'taskList' ? '- [ ] ' : '- ';
  const rest = lines.slice(1);
  return [prefix + first.trim(), ...rest].join('\n');
}

export function applyBlockTypeSelection(
  view: EditorView,
  id: string,
  blockOverride: BlockDescriptor | null = null
) {
  const block = blockOverride ?? describeBlockAt(view.state, view.state.selection.main.head);
  if (!block) {
    return false;
  }

  const text = view.state.sliceDoc(block.from, block.to);

  if (id === 'paragraph') {
    return replaceBlock(view, block, toParagraph(text), block.from);
  }

  if (id.startsWith('heading')) {
    const level = Number.parseInt(id.replace('heading', ''), 10);
    if (!Number.isFinite(level) || level < 1 || level > 6) {
      return false;
    }
    return replaceBlock(view, block, toHeading(text, level), block.from + level + 1);
  }

  if (id === 'quote') {
    return replaceBlock(view, block, toQuote(text), block.from + 2);
  }

  if (id === 'bulletList' || id === 'orderedList' || id === 'taskList') {
    return replaceBlock(view, block, toList(text, id), block.from + (id === 'orderedList' ? 3 : id === 'taskList' ? 6 : 2));
  }

  if (id === 'code') {
    return replaceBlock(view, block, toCode(text), block.from + 4);
  }

  if (id === 'divider') {
    return replaceBlock(view, block, '---', block.from + 3);
  }

  if (id === 'wikilink') {
    const { from, to } = view.state.selection.main;
    return applySpec(view, {
      changes: { from, to, insert: '[[]]' },
      selection: { anchor: from + 2 },
      scrollIntoView: true
    });
  }

  return false;
}

export function insertParagraphBelow(
  view: EditorView,
  blockOverride: BlockDescriptor | null = null
) {
  const block = blockOverride ?? describeBlockAt(view.state, view.state.selection.main.head);
  if (!block) {
    return false;
  }

  const insertPos = block.moveTo;
  const prefix = insertPos > 0 && view.state.sliceDoc(insertPos - 1, insertPos) !== '\n' ? '\n' : '';
  const suffix = insertPos < view.state.doc.length ? '\n\n' : '\n';
  const insert = `${prefix}${suffix}`;
  const anchor = insertPos + prefix.length + 1;
  return applySpec(view, {
    changes: { from: insertPos, to: insertPos, insert },
    selection: { anchor },
    scrollIntoView: true
  });
}

function reorderText(text: string, source: BlockDescriptor, target: BlockDescriptor, before: boolean) {
  const sourceSlice = text.slice(source.from, source.moveTo);
  const withoutSource = text.slice(0, source.from) + text.slice(source.moveTo);
  let targetPos = before ? target.from : target.moveTo;
  if (targetPos > source.from) {
    targetPos -= source.moveTo - source.from;
  }
  return {
    text: withoutSource.slice(0, targetPos) + sourceSlice + withoutSource.slice(targetPos),
    anchor: targetPos
  };
}

function replaceWholeDoc(view: EditorView, text: string, anchor: number) {
  return applySpec(view, {
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: Math.max(0, Math.min(anchor, text.length)) },
    scrollIntoView: true
  });
}

export function moveCurrentBlock(view: EditorView, direction: -1 | 1) {
  const blocks = listBlocks(view.state);
  const current = describeBlockAt(view.state, view.state.selection.main.head);
  if (!current) {
    return false;
  }

  const index = blocks.findIndex((candidate) => candidate.from === current.from && candidate.to === current.to);
  const target = blocks[index + direction];
  if (!target) {
    return false;
  }

  const reordered = reorderText(view.state.doc.toString(), current, target, direction < 0);
  return replaceWholeDoc(view, reordered.text, reordered.anchor);
}

export function moveBlockTo(view: EditorView, source: BlockDescriptor, target: BlockDescriptor, before: boolean) {
  const reordered = reorderText(view.state.doc.toString(), source, target, before);
  return replaceWholeDoc(view, reordered.text, reordered.anchor);
}

export function getClipboardMarkdownForCurrentBlock(view: EditorView) {
  const block = describeBlockAt(view.state, view.state.selection.main.head);
  if (!block) {
    return null;
  }
  return view.state.sliceDoc(block.from, block.to);
}

export function deleteCurrentBlock(view: EditorView) {
  const block = describeBlockAt(view.state, view.state.selection.main.head);
  if (!block) {
    return false;
  }

  const nextText = view.state.doc.toString().slice(0, block.from) + view.state.doc.toString().slice(block.moveTo);
  const normalized = nextText.trim() === '' ? '\n' : nextText.replace(/^\n+/, '');
  const anchor = Math.max(0, Math.min(block.from, normalized.length));
  return replaceWholeDoc(view, normalized, anchor);
}
