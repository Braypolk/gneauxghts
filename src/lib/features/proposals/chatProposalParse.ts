import type { NoteChange } from '$lib/types/proposals';
import { hashMarkdownContent } from './api';

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

/**
 * Resolve drafts into OCC-ready NoteChange[] using context note path/hash.
 */
export async function resolveChatProposalDrafts(
  drafts: ChatProposalDraft[],
  context: ChatProposalContext,
  hashFn: (markdown: string) => Promise<string> = hashMarkdownContent
): Promise<{
  changes: NoteChange[];
  baseMarkdownByPath: Record<string, string>;
} | null> {
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

    const baseMarkdown = baseMarkdownByPath[path] ?? '';
    const baseContentHash = await hashFn(baseMarkdown);

    if (draft.kind === 'updateNote') {
      changes.push({
        kind: 'updateNote',
        path,
        baseContentHash,
        newTitle: draft.newTitle.trim() || context.title || 'Note',
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
