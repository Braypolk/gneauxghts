import type { NoteChange, ProposedTextEdit } from '$lib/types/proposals';
import { hashMarkdownContent, hashNoteAtPath } from './api';

/** Draft shapes emitted by make-mode (no content hashes — filled client-side). */
export type ChatProposalDraft =
  | {
      kind: 'updateNote';
      path?: string | null;
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
      path?: string | null;
    };

export interface ChatProposalContext {
  path: string | null;
  title: string;
  lastSavedMarkdown: string;
}

const FENCE_RE = /```(?:gneauxghts-proposal|proposal)\s*\r?\n([\s\S]*?)```/i;

function parseTextEdit(value: unknown): ProposedTextEdit | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'replace') {
    if (typeof value.oldText !== 'string' || typeof value.newText !== 'string') return null;
    return {
      kind: 'replace',
      oldText: value.oldText,
      newText: value.newText,
      ...(typeof value.contextBefore === 'string' ? { contextBefore: value.contextBefore } : {}),
      ...(typeof value.contextAfter === 'string' ? { contextAfter: value.contextAfter } : {})
    };
  }
  if (value.kind === 'insert') {
    if (typeof value.newText !== 'string') return null;
    return {
      kind: 'insert',
      newText: value.newText,
      ...(typeof value.contextBefore === 'string' ? { contextBefore: value.contextBefore } : {}),
      ...(typeof value.contextAfter === 'string' ? { contextAfter: value.contextAfter } : {})
    };
  }
  return null;
}

/**
 * Extract the new active-note edit protocol. Legacy full-body proposals are
 * deliberately converted to one trusted whole-body replacement rather than
 * trusting any model-provided path or hash.
 */
export function parseChatProposalEdits(content: string, baseMarkdown: string): ProposedTextEdit[] | null {
  const fence = extractProposalFence(content);
  if (!fence) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fence) as unknown;
  } catch {
    return null;
  }
  if (isRecord(parsed) && Array.isArray(parsed.edits)) {
    const edits = parsed.edits.map(parseTextEdit).filter((edit): edit is ProposedTextEdit => edit !== null);
    return edits.length > 0 ? edits : null;
  }
  if (isRecord(parsed) && Array.isArray(parsed.changes)) {
    const update = parsed.changes.find((change) => isRecord(change) && Array.isArray(change.edits));
    if (isRecord(update) && Array.isArray(update.edits)) {
      const edits = update.edits
        .map(parseTextEdit)
        .filter((edit): edit is ProposedTextEdit => edit !== null);
      return edits.length > 0 ? edits : null;
    }
    const legacy = parsed.changes.find(
      (change) => isRecord(change) && (change.kind === 'updateNote' || 'newMarkdown' in change) && typeof change.newMarkdown === 'string'
    );
    if (isRecord(legacy) && typeof legacy.newMarkdown === 'string') {
      return [{ kind: 'replace', oldText: baseMarkdown || '\n', newText: legacy.newMarkdown }];
    }
  }
  if (isRecord(parsed) && typeof parsed.newMarkdown === 'string') {
    return [{ kind: 'replace', oldText: baseMarkdown || '\n', newText: parsed.newMarkdown }];
  }
  return null;
}

export function extractProposalFence(content: string): string | null {
  const match = content.match(FENCE_RE);
  const body = match?.[1]?.trim();
  return body && body.length > 0 ? body : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Basename without `.md` — used when context title is empty. */
function titleFromNotePath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.md$/i, '').trim();
}

/**
 * Pathless / context-path updates keep the open note's title.
 * Models often invent a different newTitle (e.g. from wikilinks), which would
 * rename onto another existing file and fail Keep with "target already exists".
 */
function resolveUpdateTitle(
  draftTitle: string,
  context: ChatProposalContext,
  path: string,
  isContextUpdate: boolean
): string {
  if (isContextUpdate) {
    return (
      context.title.trim() ||
      titleFromNotePath(path) ||
      draftTitle.trim() ||
      'Note'
    );
  }
  return draftTitle.trim() || context.title.trim() || titleFromNotePath(path) || 'Note';
}

function parseDraft(value: unknown): ChatProposalDraft | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;

  if (kind === 'updateNote') {
    const newTitle = typeof value.newTitle === 'string' ? value.newTitle : '';
    const newMarkdown = typeof value.newMarkdown === 'string' ? value.newMarkdown : null;
    if (newMarkdown === null) return null;
    return {
      kind: 'updateNote',
      path: typeof value.path === 'string' ? value.path : null,
      newTitle,
      newMarkdown
    };
  }

  if (kind === 'createNote') {
    const suggestedTitle =
      typeof value.suggestedTitle === 'string' ? value.suggestedTitle : '';
    const markdown = typeof value.markdown === 'string' ? value.markdown : null;
    if (markdown === null) return null;
    return { kind: 'createNote', suggestedTitle, markdown };
  }

  if (kind === 'deleteNote') {
    return {
      kind: 'deleteNote',
      path: typeof value.path === 'string' ? value.path : null
    };
  }

  // Shorthand: bare update of the context note.
  if ('newMarkdown' in value && typeof value.newMarkdown === 'string') {
    return {
      kind: 'updateNote',
      path: typeof value.path === 'string' ? value.path : null,
      newTitle: typeof value.newTitle === 'string' ? value.newTitle : '',
      newMarkdown: value.newMarkdown
    };
  }

  return null;
}

/**
 * Parse a make-mode `gneauxghts-proposal` fence into draft changes.
 * Returns null when no fence / invalid JSON / empty changes.
 */
export function parseChatProposalDrafts(content: string): ChatProposalDraft[] | null {
  const fence = extractProposalFence(content);
  if (!fence) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fence) as unknown;
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    const drafts = parsed.map(parseDraft).filter((draft): draft is ChatProposalDraft => draft !== null);
    return drafts.length > 0 ? drafts : null;
  }

  if (!isRecord(parsed)) return null;

  if (Array.isArray(parsed.changes)) {
    const drafts = parsed.changes
      .map(parseDraft)
      .filter((draft): draft is ChatProposalDraft => draft !== null);
    return drafts.length > 0 ? drafts : null;
  }

  const single = parseDraft(parsed);
  return single ? [single] : null;
}

export interface ResolveChatProposalOptions {
  /** Prefer on-disk file hash for OCC (default: hashNoteAtPath). */
  hashNotePath?: (path: string) => Promise<string>;
  /** Fallback when hashing body text only (tests). */
  hashMarkdown?: (markdown: string) => Promise<string>;
}

/**
 * Resolve drafts into OCC-ready NoteChange[] using context note path/hash.
 */
export async function resolveChatProposalDrafts(
  drafts: ChatProposalDraft[],
  context: ChatProposalContext,
  options: ResolveChatProposalOptions = {}
): Promise<{
  changes: NoteChange[];
  baseMarkdownByPath: Record<string, string>;
} | null> {
  const hashNotePath = options.hashNotePath ?? hashNoteAtPath;
  const hashMarkdown = options.hashMarkdown ?? hashMarkdownContent;
  const changes: NoteChange[] = [];
  const baseMarkdownByPath: Record<string, string> = {};

  for (const draft of drafts) {
    if (draft.kind === 'createNote') {
      changes.push({
        kind: 'createNote',
        suggestedTitle: draft.suggestedTitle,
        markdown: draft.markdown
      });
      continue;
    }

    const path = asNonEmptyString(draft.path) ?? asNonEmptyString(context.path);
    if (!path) {
      return null;
    }

    if (!(path in baseMarkdownByPath)) {
      if (path !== context.path) {
        // Multi-file proposals need the open context note path for now.
        return null;
      }
      baseMarkdownByPath[path] = context.lastSavedMarkdown;
    }

    // OCC validates against full on-disk bytes, not the editor body snapshot.
    let baseContentHash: string;
    try {
      baseContentHash = await hashNotePath(path);
    } catch {
      const baseMarkdown = baseMarkdownByPath[path] ?? '';
      baseContentHash = await hashMarkdown(baseMarkdown);
    }

    if (draft.kind === 'updateNote') {
      const isContextUpdate =
        !asNonEmptyString(draft.path) || draft.path === context.path;
      changes.push({
        kind: 'updateNote',
        path,
        baseContentHash,
        newTitle: resolveUpdateTitle(draft.newTitle, context, path, isContextUpdate),
        newMarkdown: draft.newMarkdown
      });
    } else {
      changes.push({
        kind: 'deleteNote',
        path,
        baseContentHash
      });
    }
  }

  return changes.length > 0 ? { changes, baseMarkdownByPath } : null;
}
