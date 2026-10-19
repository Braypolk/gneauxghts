import { diffArrays } from 'diff';

type TextPart = { text: string; changed: boolean };
type InlinePart = { text: string; kind: 'context' | 'removed' | 'added' };
export type ReviewChange = { before: TextPart[]; after: TextPart[]; inline: InlinePart[]; spacingChanged: boolean; context?: string };

function highlight(before: string, after: string): ReviewChange | null {
  const words = (text: string) => text.match(/\s+|[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]+/gu) ?? [];
  // Keep shared words and line breaks between edits. Bound expensive comparisons;
  // the caller falls back to the exact technical patch if highlighting aborts.
  const edits = diffArrays(words(before), words(after), { maxEditLength: 1000 });
  if (!edits) return null;
  const inline: InlinePart[] = edits.map(part => ({
    text: part.value.join(''), kind: part.removed ? 'removed' : part.added ? 'added' : 'context'
  }));
  const parts = (excluded: InlinePart['kind']): TextPart[] => inline.filter(part => part.kind !== excluded)
    .map(part => ({ text: part.text, changed: part.kind !== 'context' }));
  return { before: parts('added'), after: parts('removed'), inline, spacingChanged: before !== after && before.replace(/\s/gu, '') === after.replace(/\s/gu, '') };
}

/** Presentation of Pi's unified patch. Never changes the candidate or approval. */
export function editReviewChanges(patch: string): ReviewChange[] | null {
  const lines = patch.split('\n');
  if (!lines[0]?.startsWith('--- ') || !lines[1]?.startsWith('+++ ')) return null;
  const changes: ReviewChange[] = [];
  let complete = true;
  let before: string[] = [], after: string[] = [];
  let oldRemaining = 0, newRemaining = 0, inHunk = false;
  let lastLine = '';
  let preceding: string[] = [];
  const flush = () => {
    if (before.length || after.length) {
      const context = preceding.findLast(line => /^\s{0,3}#{1,6}\s/.test(line)) ?? preceding.join('\n');
      const highlighted = highlight(before.join(''), after.join(''));
      if (highlighted) changes.push({ ...highlighted, ...(context ? { context } : {}) });
      else complete = false;
      preceding = [];
    }
    before = []; after = [];
  };
  for (let index = 2; index < lines.length; index++) {
    const line = lines[index];
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (header) {
      if (oldRemaining || newRemaining) return null;
      flush(); inHunk = true;
      preceding = [];
      lastLine = '';
      oldRemaining = Number(header[1] ?? 1); newRemaining = Number(header[2] ?? 1);
    } else if (line === '\\ No newline at end of file') {
      if (!inHunk || !lastLine) return null;
      if (lastLine === '-') before[before.length - 1] = before[before.length - 1].slice(0, -1);
      if (lastLine === '+') after[after.length - 1] = after[after.length - 1].slice(0, -1);
      lastLine = '';
    } else if (index === lines.length - 1 && line === '' && !oldRemaining && !newRemaining) {
      // Unified patches conventionally end with a newline.
    } else if (!inHunk) return null;
    else if (line.startsWith('-')) { before.push(`${line.slice(1)}\n`); oldRemaining--; lastLine = '-'; }
    else if (line.startsWith('+')) { after.push(`${line.slice(1)}\n`); newRemaining--; lastLine = '+'; }
    else if (line.startsWith(' ')) {
      flush(); oldRemaining--; newRemaining--; lastLine = ' ';
      const context = line.slice(1);
      // Keep a short leading excerpt, excluding managed frontmatter context.
      if (context.trim() === '---') preceding = [];
      else if (context.trim() && !/^\s*(?:id|title|created_at|updated_at|trashed_at):/.test(context)) preceding = [...preceding, context].slice(-2);
    }
    else return null;
    if (oldRemaining < 0 || newRemaining < 0) return null;
  }
  flush();
  return complete && inHunk && !oldRemaining && !newRemaining && changes.length ? changes : null;
}
