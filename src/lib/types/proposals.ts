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
  kind: 'updateNote' | 'createNote' | 'deleteNote';
  path: string | null;
  previousPath: string | null;
}

export interface ApplyNoteChangesResult {
  applied: AppliedNoteChange[];
}

export interface NoteChangePreview {
  id: string;
  kind: NoteChange['kind'];
  title: string;
  path: string | null;
  proposedMarkdown: string | null;
}

export interface NoteChangeReviewItem extends NoteChangePreview {
  baseContentHash: string | null;
  actionLabel: string;
  canApply: boolean;
}

export interface NoteChangeReviewModel {
  source: string;
  items: NoteChangeReviewItem[];
  applyableChanges: NoteChange[];
}

export function buildNoteChangePreviews(changes: readonly NoteChange[]): NoteChangePreview[] {
  return changes.map((change, index) => {
    if (change.kind === 'updateNote') {
      return {
        id: `${index}:update:${change.path}`,
        kind: change.kind,
        title: change.newTitle || fileNameTitle(change.path),
        path: change.path,
        proposedMarkdown: change.newMarkdown
      };
    }

    if (change.kind === 'createNote') {
      return {
        id: `${index}:create:${change.suggestedTitle}`,
        kind: change.kind,
        title: change.suggestedTitle || firstMarkdownTitle(change.markdown) || 'Untitled',
        path: null,
        proposedMarkdown: change.markdown
      };
    }

    return {
      id: `${index}:delete:${change.path}`,
      kind: change.kind,
      title: fileNameTitle(change.path),
      path: change.path,
      proposedMarkdown: null
    };
  });
}

export function buildNoteChangeReviewModel(
  changes: readonly NoteChange[],
  source = 'manual'
): NoteChangeReviewModel {
  const previews = buildNoteChangePreviews(changes);
  const items = previews.map((preview, index): NoteChangeReviewItem => {
    const change = changes[index];
    return {
      ...preview,
      baseContentHash:
        change.kind === 'createNote' ? null : change.baseContentHash,
      actionLabel:
        change.kind === 'createNote'
          ? 'Create'
          : change.kind === 'updateNote'
            ? 'Update'
            : 'Delete',
      canApply:
        change.kind === 'createNote' ||
        (change.baseContentHash.trim() !== '' && change.path.trim() !== '')
    };
  });

  return {
    source,
    items,
    applyableChanges: changes.filter((_, index) => items[index].canApply)
  };
}

function fileNameTitle(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || path;
}

function firstMarkdownTitle(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.replace(/^#+\s*/, '')
    .trim();
}
