export type NoteChange =
  | {
      kind: 'updateNote';
      path: string;
      baseContentHash: string;
      newTitle: string;
      newMarkdown: string;
    }
  | {
      kind: 'createNote';
      suggestedTitle: string;
      markdown: string;
    }
  | {
      kind: 'deleteNote';
      path: string;
      baseContentHash: string;
    };

export interface AppliedNoteChange {
  kind: string;
  path: string | null;
  previousPath: string | null;
}

export interface ApplyNoteChangesResult {
  applied: AppliedNoteChange[];
}

export function noteChangePath(change: NoteChange): string | null {
  if (change.kind === 'createNote') return null;
  return change.path;
}

export function noteChangeTitle(change: NoteChange): string {
  if (change.kind === 'updateNote') {
    return change.newTitle.trim() || fileNameTitle(change.path);
  }
  if (change.kind === 'createNote') {
    return (
      change.suggestedTitle.trim() ||
      firstMarkdownTitle(change.markdown) ||
      'Untitled'
    );
  }
  return fileNameTitle(change.path);
}

export function noteChangeProposedMarkdown(change: NoteChange): string | null {
  if (change.kind === 'updateNote') return change.newMarkdown;
  if (change.kind === 'createNote') return change.markdown;
  return null;
}

export function fileNameTitle(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || path;
}

function firstMarkdownTitle(markdown: string): string | undefined {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/^#+\s*/, '')
    .trim();
}
