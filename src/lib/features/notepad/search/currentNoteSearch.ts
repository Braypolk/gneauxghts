import { EditorState } from '@codemirror/state';
import { SearchQuery } from '@codemirror/search';
import type { SearchItem } from '$lib/types/semantic';

export interface CurrentNoteSearchOptions {
  title: string;
  noteId: string | null;
  notePath: string | null;
  markdown: string;
  query: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  limit?: number;
}

const DEFAULT_CURRENT_NOTE_SEARCH_LIMIT = 200;
const CURRENT_NOTE_EXCERPT_LENGTH = 130;
const CURRENT_NOTE_EXCERPT_CONTEXT = 24;

function searchableBodyStart(markdown: string) {
  const normalizedStart = markdown.startsWith('\uFEFF') ? 1 : 0;
  const firstLineEnd = markdown.indexOf('\n', normalizedStart);
  if (firstLineEnd < 0 || markdown.slice(normalizedStart, firstLineEnd).trim() !== '---') {
    return 0;
  }

  let lineStart = firstLineEnd + 1;
  while (lineStart <= markdown.length) {
    const lineEnd = markdown.indexOf('\n', lineStart);
    const effectiveEnd = lineEnd < 0 ? markdown.length : lineEnd;
    if (markdown.slice(lineStart, effectiveEnd).trim() === '---') {
      return lineEnd < 0 ? markdown.length : lineEnd + 1;
    }
    if (lineEnd < 0) break;
    lineStart = lineEnd + 1;
  }

  return 0;
}

function cropLineAroundMatch(lineText: string, matchStart: number, matchEnd: number) {
  const contextStart = Math.max(0, matchStart - CURRENT_NOTE_EXCERPT_CONTEXT);
  const maxStart = Math.max(0, lineText.length - CURRENT_NOTE_EXCERPT_LENGTH);
  const start = Math.min(contextStart, maxStart);
  const end = Math.min(lineText.length, Math.max(matchEnd + CURRENT_NOTE_EXCERPT_CONTEXT, start + CURRENT_NOTE_EXCERPT_LENGTH));
  const prefix = start > 0 ? '…' : '';
  const suffix = end < lineText.length ? '…' : '';
  const excerpt = `${prefix}${lineText.slice(start, end)}${suffix}`;
  const offset = prefix.length - start;

  return {
    excerpt,
    highlightRanges: [
      {
        start: Math.max(0, matchStart + offset),
        end: Math.max(0, matchEnd + offset)
      }
    ]
  };
}

export function buildCurrentNoteSearchResults({
  title,
  noteId,
  notePath,
  markdown,
  query,
  matchCase,
  matchWholeWord,
  limit = DEFAULT_CURRENT_NOTE_SEARCH_LIMIT
}: CurrentNoteSearchOptions): SearchItem[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    return [];
  }

  const state = EditorState.create({ doc: markdown });
  const searchQuery = new SearchQuery({
    search: trimmedQuery,
    caseSensitive: matchCase,
    wholeWord: matchWholeWord,
    literal: true
  });
  const cursor = searchQuery.getCursor(state);
  const results: SearchItem[] = [];
  const bodyStart = searchableBodyStart(markdown);

  while (results.length < limit) {
    const next = cursor.next();
    if (next.done) {
      break;
    }

    const { from, to } = next.value;
    if (to <= bodyStart) {
      continue;
    }
    const line = state.doc.lineAt(from);
    const lineMatchStart = Math.max(0, from - line.from);
    const lineMatchEnd = Math.max(lineMatchStart, Math.min(line.text.length, to - line.from));
    const { excerpt, highlightRanges } = cropLineAroundMatch(
      line.text,
      lineMatchStart,
      lineMatchEnd
    );

    results.push({
      noteId,
      notePath,
      fileName: title.trim() || 'Untitled',
      sectionLabel: `Line ${line.number}`,
      excerpt,
      highlightRanges,
      matchText: state.sliceDoc(from, to),
      reasonLabels: ['keyword'],
      lexicalScore: null,
      semanticScore: null,
      startLine: line.number,
      endLine: state.doc.lineAt(to).number,
      currentMatchRange: { from, to }
    });
  }

  return results;
}
