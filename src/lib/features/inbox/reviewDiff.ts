import type { AiChange, AiChangePreview } from '$lib/types/ai';

type DiffEntryKind = 'equal' | 'add' | 'remove';

interface DiffEntry {
  kind: DiffEntryKind;
  text: string;
  oldIndex: number;
  newIndex: number;
}

interface DiffRun {
  kind: DiffEntryKind;
  lines: string[];
  startOld: number;
  startNew: number;
}

export interface DiffDisplayLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface ReviewHunk {
  id: string;
  selected: boolean;
  oldStart: number;
  oldEnd: number;
  newLines: string[];
  lines: DiffDisplayLine[];
}

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
  titleSelected: boolean;
  hunks: ReviewHunk[];
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

const DIFF_CONTEXT_LINES = 3;
const MAX_FULL_DIFF_CELLS = 1_000_000;

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
        titleSelected: proposedTitle !== currentTitle,
        hunks: buildReviewHunks(currentMarkdown, change.newMarkdown)
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
    if (reviewChange.kind === 'createNote') {
      if (reviewChange.selected) {
        approvedChanges.push(reviewChange.change);
      }
      continue;
    }

    if (reviewChange.kind === 'deleteNote') {
      if (reviewChange.selected) {
        approvedChanges.push(reviewChange.change);
      }
      continue;
    }

    const nextMarkdown = applySelectedHunks(
      reviewChange.currentMarkdown,
      reviewChange.hunks.filter((hunk) => hunk.selected)
    );
    const nextTitle = reviewChange.titleSelected
      ? reviewChange.proposedTitle
      : reviewChange.currentTitle;

    if (
      nextMarkdown === reviewChange.currentMarkdown &&
      nextTitle === reviewChange.currentTitle
    ) {
      continue;
    }

    approvedChanges.push({
        kind: 'updateNote',
        path: reviewChange.path,
        baseContentHash: reviewChange.baseContentHash,
        newTitle: nextTitle,
        newMarkdown: nextMarkdown
      });
  }
  return approvedChanges;
}

export function isReviewChangeSelected(reviewChange: ReviewChange) {
  if (reviewChange.kind === 'createNote' || reviewChange.kind === 'deleteNote') {
    return reviewChange.selected;
  }

  return (
    (reviewChange.titleChanged && reviewChange.titleSelected) ||
    reviewChange.hunks.some((hunk) => hunk.selected)
  );
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

export function acceptedHunkCount(reviewChange: ReviewChange) {
  if (reviewChange.kind !== 'updateNote') {
    return isReviewChangeSelected(reviewChange) ? 1 : 0;
  }
  return reviewChange.hunks.filter((hunk) => hunk.selected).length;
}

export function diffLinePrefix(line: DiffDisplayLine) {
  if (line.kind === 'add') return '+';
  if (line.kind === 'remove') return '-';
  return ' ';
}

export function setReviewChangeSelection(reviewChange: ReviewChange, selected: boolean) {
  if (reviewChange.kind === 'createNote' || reviewChange.kind === 'deleteNote') {
    reviewChange.selected = selected;
    return;
  }

  reviewChange.titleSelected = selected && reviewChange.titleChanged;
  for (const hunk of reviewChange.hunks) {
    hunk.selected = selected;
  }
}

export function applySelectedHunks(currentMarkdown: string, selectedHunks: ReviewHunk[]) {
  const lines = splitLines(currentMarkdown);
  const sortedHunks = [...selectedHunks].sort((left, right) => right.oldStart - left.oldStart);
  for (const hunk of sortedHunks) {
    lines.splice(hunk.oldStart, hunk.oldEnd - hunk.oldStart, ...hunk.newLines);
  }
  return joinLines(lines);
}

function buildReviewHunks(currentMarkdown: string, proposedMarkdown: string): ReviewHunk[] {
  const runs = buildDiffRuns(splitLines(currentMarkdown), splitLines(proposedMarkdown));
  const hunks = buildDiffHunks(runs);
  return hunks.map((hunk, index) => ({
    id: `hunk-${index}`,
    selected: true,
    oldStart: hunk.oldStart,
    oldEnd: hunk.oldEnd,
    newLines: hunk.newLines,
    lines: hunk.lines
  }));
}

function buildDiffRuns(oldLines: string[], newLines: string[]) {
  const entries = buildDiffEntries(oldLines, newLines);
  const runs: DiffRun[] = [];
  for (const entry of entries) {
    const startOld = entry.oldIndex;
    const startNew = entry.newIndex;
    const previous = runs.at(-1);
    if (previous && previous.kind === entry.kind) {
      previous.lines.push(entry.text);
      continue;
    }
    runs.push({
      kind: entry.kind,
      lines: [entry.text],
      startOld,
      startNew
    });
  }
  return runs;
}

function buildDiffEntries(oldLines: string[], newLines: string[]): DiffEntry[] {
  if ((oldLines.length + 1) * (newLines.length + 1) > MAX_FULL_DIFF_CELLS) {
    return buildReplaceAllDiffEntries(oldLines, newLines);
  }

  const dp = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      dp[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? dp[oldIndex + 1][newIndex + 1] + 1
          : Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1]);
    }
  }

  const entries: DiffEntry[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      entries.push({
        kind: 'equal',
        text: oldLines[oldIndex],
        oldIndex,
        newIndex
      });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1]) {
      entries.push({
        kind: 'remove',
        text: oldLines[oldIndex],
        oldIndex,
        newIndex
      });
      oldIndex += 1;
      continue;
    }

    entries.push({
      kind: 'add',
      text: newLines[newIndex],
      oldIndex,
      newIndex
    });
    newIndex += 1;
  }

  while (oldIndex < oldLines.length) {
    entries.push({
      kind: 'remove',
      text: oldLines[oldIndex],
      oldIndex,
      newIndex
    });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    entries.push({
      kind: 'add',
      text: newLines[newIndex],
      oldIndex,
      newIndex
    });
    newIndex += 1;
  }

  return entries;
}

function buildReplaceAllDiffEntries(oldLines: string[], newLines: string[]): DiffEntry[] {
  return [
    ...oldLines.map((text, oldIndex) => ({
      kind: 'remove' as const,
      text,
      oldIndex,
      newIndex: 0
    })),
    ...newLines.map((text, newIndex) => ({
      kind: 'add' as const,
      text,
      oldIndex: oldLines.length,
      newIndex
    }))
  ];
}

function buildDiffHunks(runs: DiffRun[]) {
  const changeIndexes = runs
    .map((run, index) => (run.kind === 'equal' ? -1 : index))
    .filter((index) => index >= 0);

  if (changeIndexes.length === 0) {
    return [];
  }

  const blocks: Array<{ startIndex: number; endIndex: number }> = [];
  let blockStart = changeIndexes[0];
  let blockEnd = changeIndexes[0];

  for (const nextChangeIndex of changeIndexes.slice(1)) {
    const equalLinesBetween = sumEqualLines(runs.slice(blockEnd + 1, nextChangeIndex));
    if (equalLinesBetween <= DIFF_CONTEXT_LINES * 2) {
      blockEnd = nextChangeIndex;
      continue;
    }
    blocks.push({ startIndex: blockStart, endIndex: blockEnd });
    blockStart = nextChangeIndex;
    blockEnd = nextChangeIndex;
  }
  blocks.push({ startIndex: blockStart, endIndex: blockEnd });

  return blocks.map(({ startIndex, endIndex }) => {
    const prefixRun = startIndex > 0 && runs[startIndex - 1]?.kind === 'equal' ? runs[startIndex - 1] : null;
    const suffixRun =
      endIndex + 1 < runs.length && runs[endIndex + 1]?.kind === 'equal' ? runs[endIndex + 1] : null;

    const lines: DiffDisplayLine[] = [];
    if (prefixRun) {
      const prefixLines = prefixRun.lines.slice(-DIFF_CONTEXT_LINES);
      const prefixOffset = prefixRun.lines.length - prefixLines.length;
      prefixLines.forEach((text, index) => {
        lines.push({
          kind: 'context',
          text,
          oldLineNumber: prefixRun.startOld + prefixOffset + index + 1,
          newLineNumber: prefixRun.startNew + prefixOffset + index + 1
        });
      });
    }

    for (let index = startIndex; index <= endIndex; index += 1) {
      const run = runs[index];
      run.lines.forEach((text, lineIndex) => {
        lines.push({
          kind: run.kind === 'equal' ? 'context' : run.kind,
          text,
          oldLineNumber:
            run.kind === 'add' ? null : run.startOld + lineIndex + 1,
          newLineNumber:
            run.kind === 'remove' ? null : run.startNew + lineIndex + 1
        });
      });
    }

    if (suffixRun) {
      suffixRun.lines.slice(0, DIFF_CONTEXT_LINES).forEach((text, index) => {
        lines.push({
          kind: 'context',
          text,
          oldLineNumber: suffixRun.startOld + index + 1,
          newLineNumber: suffixRun.startNew + index + 1
        });
      });
    }

    const affectedRuns = runs.slice(startIndex, endIndex + 1);
    return {
      oldStart: affectedRuns[0]?.startOld ?? 0,
      oldEnd:
        (affectedRuns[0]?.startOld ?? 0) +
        affectedRuns.reduce((total, run) => total + consumeOldLines(run), 0),
      newLines: affectedRuns.flatMap((run) => (run.kind === 'remove' ? [] : run.lines)),
      lines
    };
  });
}

function sumEqualLines(runs: DiffRun[]) {
  return runs.reduce(
    (total, run) => total + (run.kind === 'equal' ? run.lines.length : 0),
    0
  );
}

function consumeOldLines(run: DiffRun) {
  return run.kind === 'add' ? 0 : run.lines.length;
}

function splitLines(value: string) {
  if (value === '') {
    return [];
  }
  return value.replace(/\r\n/g, '\n').split('\n');
}

function joinLines(lines: string[]) {
  return lines.join('\n');
}

function fallbackTitleFromPath(path: string) {
  return path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Note';
}
