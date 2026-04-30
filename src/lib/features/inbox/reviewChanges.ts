import type { AiChange, AiChangePreview } from '$lib/types/ai';

export interface ReviewUpdateChange {
  id: string;
  kind: 'updateNote';
  path: string;
  baseContentHash: string;
  currentTitle: string;
  currentMarkdown: string;
  proposedTitle: string;
  proposedMarkdown: string;
  titleChanged: boolean;
  selected: boolean;
}

export interface ReviewCreateChange {
  id: string;
  kind: 'createNote';
  change: Extract<AiChange, { kind: 'createNote' }>;
  selected: boolean;
}

export interface ReviewDeleteChange {
  id: string;
  kind: 'deleteNote';
  change: Extract<AiChange, { kind: 'deleteNote' }>;
  title: string;
  selected: boolean;
}

export type ReviewChange = ReviewUpdateChange | ReviewCreateChange | ReviewDeleteChange;

export function buildReviewChanges(changePreviews: AiChangePreview[]): ReviewChange[] {
  return changePreviews.map((changePreview, index) => {
    const { change } = changePreview;
    if (change.kind === 'updateNote') {
      const currentTitle = changePreview.currentTitle ?? fallbackTitleFromPath(change.path);
      const currentMarkdown = changePreview.currentMarkdown ?? '';
      const proposedTitle = change.newTitle.trim() === '' ? currentTitle : change.newTitle;
      return {
        id: `updateNote:${change.path}`,
        kind: 'updateNote',
        path: change.path,
        baseContentHash: change.baseContentHash,
        currentTitle,
        currentMarkdown,
        proposedTitle,
        proposedMarkdown: change.newMarkdown,
        titleChanged: proposedTitle !== currentTitle,
        selected: true
      } satisfies ReviewUpdateChange;
    }

    if (change.kind === 'createNote') {
      return {
        id: `createNote:${index}:${change.suggestedTitle}`,
        kind: 'createNote',
        change,
        selected: true
      } satisfies ReviewCreateChange;
    }

    return {
      id: `deleteNote:${change.path}`,
      kind: 'deleteNote',
      change,
      title: changePreview.currentTitle ?? fallbackTitleFromPath(change.path),
      selected: true
    } satisfies ReviewDeleteChange;
  });
}

export function buildApprovedChanges(reviewChanges: ReviewChange[]): AiChange[] {
  const approvedChanges: AiChange[] = [];
  for (const reviewChange of reviewChanges) {
    if (!reviewChange.selected) {
      continue;
    }

    if (reviewChange.kind === 'createNote' || reviewChange.kind === 'deleteNote') {
      approvedChanges.push(reviewChange.change);
      continue;
    }

    if (
      reviewChange.proposedMarkdown === reviewChange.currentMarkdown &&
      reviewChange.proposedTitle === reviewChange.currentTitle
    ) {
      continue;
    }

    approvedChanges.push({
      kind: 'updateNote',
      path: reviewChange.path,
      baseContentHash: reviewChange.baseContentHash,
      newTitle: reviewChange.proposedTitle,
      newMarkdown: reviewChange.proposedMarkdown
    });
  }
  return approvedChanges;
}

export function isReviewChangeSelected(reviewChange: ReviewChange) {
  return reviewChange.selected;
}

export function getReviewChangePath(reviewChange: ReviewChange) {
  if (reviewChange.kind === 'updateNote') {
    return reviewChange.path;
  }
  if (reviewChange.kind === 'deleteNote') {
    return reviewChange.change.path;
  }
  return null;
}

export function reviewChangeTitle(reviewChange: ReviewChange) {
  if (reviewChange.kind === 'updateNote') {
    return reviewChange.proposedTitle || reviewChange.currentTitle || 'Updated note';
  }
  if (reviewChange.kind === 'createNote') {
    return reviewChange.change.suggestedTitle || 'New note';
  }
  return reviewChange.title || 'Deleted note';
}

function fallbackTitleFromPath(path: string) {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Note';
}
