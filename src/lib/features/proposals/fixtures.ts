import type { NoteChange } from '$lib/types/proposals';
import { hashNoteAtPath } from './api';
import { proposalReviewSession } from './reviewSession.svelte';

export interface FixtureActiveNote {
  path: string | null;
  title: string;
  /** Disk/saved editor body — used for diffs (not OCC hashes). */
  lastSavedMarkdown: string;
}

/**
 * Build proposed markdown that both deletes existing content and appends an
 * addition — so the review UI shows red removals and green additions.
 */
export function buildFixtureProposedMarkdown(base: string): string {
  const normalized = base.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/).filter((part, index, all) => {
    // Keep empty leading/trailing only when the whole note is whitespace-ish.
    if (all.length === 1) return true;
    return part.length > 0;
  });

  let remainder: string;
  if (paragraphs.length >= 2) {
    // Drop the first paragraph for a multi-line red block when possible.
    remainder = paragraphs.slice(1).join('\n\n').trimEnd();
  } else {
    const only = paragraphs[0] ?? '';
    const lines = only.split('\n');
    if (lines.length >= 2) {
      remainder = lines.slice(1).join('\n').trimEnd();
    } else if (only.trim() !== '') {
      // Single-line note: delete it entirely so the removal is still visible.
      remainder = '';
    } else {
      remainder = '';
    }
  }

  const addition =
    '## Proposed addition\n\nThis paragraph was proposed by a fixture for review UX testing.';
  return remainder ? `${remainder}\n\n${addition}\n` : `${addition}\n`;
}

/**
 * Inject a demo update against the currently open saved note.
 * Returns false if there is no saved path/content to propose against.
 */
export async function loadUpdateFixtureForActiveNote(
  note: FixtureActiveNote
): Promise<boolean> {
  if (!note.path || note.lastSavedMarkdown.trim() === '') {
    return false;
  }

  const baseContentHash = await hashNoteAtPath(note.path);
  const newTitle = `${note.title.trim() || 'Note'} (revised)`;
  const newMarkdown = buildFixtureProposedMarkdown(note.lastSavedMarkdown);

  const change: NoteChange = {
    kind: 'updateNote',
    path: note.path,
    baseContentHash,
    newTitle,
    newMarkdown
  };

  proposalReviewSession.load([change], { [note.path]: note.lastSavedMarkdown }, 'fixture');
  return true;
}

/**
 * Inject update + create fixtures so the chat list shows multiple files.
 */
export async function loadMultiFileFixture(note: FixtureActiveNote): Promise<boolean> {
  if (!note.path) {
    return false;
  }

  const baseContentHash = await hashNoteAtPath(note.path);
  const update: NoteChange = {
    kind: 'updateNote',
    path: note.path,
    baseContentHash,
    newTitle: note.title.trim() || 'Note',
    newMarkdown: buildFixtureProposedMarkdown(note.lastSavedMarkdown)
  };
  const create: NoteChange = {
    kind: 'createNote',
    suggestedTitle: 'Fixture draft note',
    markdown: '# Fixture draft note\n\nCreated by the proposal review fixture.\n'
  };

  proposalReviewSession.load(
    [update, create],
    { [note.path]: note.lastSavedMarkdown },
    'fixture'
  );
  return true;
}
