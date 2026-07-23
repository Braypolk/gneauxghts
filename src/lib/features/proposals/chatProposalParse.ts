import type { ProposedTextEdit } from '$lib/types/proposals';

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

function insertionOffsets(base: string, contextBefore: string, contextAfter?: string): number[] {
  const offsets: number[] = [];
  let searchFrom = 0;
  while (searchFrom <= base.length) {
    const match = base.indexOf(contextBefore, searchFrom);
    if (match < 0) break;
    const offset = match + contextBefore.length;
    if (!contextAfter || base.slice(offset).startsWith(contextAfter)) offsets.push(offset);
    searchFrom = match + Math.max(contextBefore.length, 1);
  }
  return offsets;
}

function normalizeMarkdownInsertion(edit: ProposedTextEdit, base: string): ProposedTextEdit {
  if (
    edit.kind !== 'insert' ||
    !edit.contextBefore ||
    edit.newText.startsWith('\n') ||
    !/^(?:[-*+] |\d+[.)] |#{1,6} |> |```|~~~)/u.test(edit.newText)
  ) {
    return edit;
  }
  const offsets = insertionOffsets(base, edit.contextBefore, edit.contextAfter);
  if (offsets.length !== 1 || offsets[0] === 0 || base[offsets[0] - 1] === '\n') return edit;
  return { ...edit, newText: `\n${edit.newText}` };
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
    const edits = parsed.edits
      .map(parseTextEdit)
      .filter((edit): edit is ProposedTextEdit => edit !== null)
      .map((edit) => normalizeMarkdownInsertion(edit, baseMarkdown));
    return edits.length > 0 ? edits : null;
  }
  if (isRecord(parsed) && Array.isArray(parsed.changes)) {
    const update = parsed.changes.find((change) => isRecord(change) && Array.isArray(change.edits));
    if (isRecord(update) && Array.isArray(update.edits)) {
      const edits = update.edits
        .map(parseTextEdit)
        .filter((edit): edit is ProposedTextEdit => edit !== null)
        .map((edit) => normalizeMarkdownInsertion(edit, baseMarkdown));
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

/** The proposal protocol is app control data, not user-facing Markdown. */
export function withoutProposalFence(content: string): string {
  return content.replace(FENCE_RE, '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
