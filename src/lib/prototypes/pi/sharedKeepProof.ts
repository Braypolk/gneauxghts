import { EditorState } from '@codemirror/state';
import type { ChatProposalDraft } from '$lib/features/chat/types';
import type { CommitNoteReviewResult, ReviewHunkState } from '$lib/types/proposals';
import { documentReviewField, resolveReviewHunk, setDocumentReview } from '$lib/features/proposals/reviewExtension';
import { sameDraft } from './reviewState';

export type SharedCanonicalNote = { noteId: string | null; path: string | null; title: string; markdown: string };
export type SharedKeepPlan = {
  proposalId: string; reviewId: string; expectedNoteId: string | null;
  reviewedDraft: ChatProposalDraft; expectedKeepDraft: ChatProposalDraft;
  expectedEditorMarkdown: string; expectedDraftSha256: string; expectedEditorSha256: string;
};
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export const sharedProofDigest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(value => value.toString(16).padStart(2, '0')).join('');

/** Predict the existing normal Keep reducer without changing the mounted editor. */
export function expectedSharedKeepDraft(draft: ChatProposalDraft, reviewId: string): ChatProposalDraft {
  assert(reviewId.length > 0, 'Shared Keep lacks exact review identity');
  const mounted = EditorState.create({ doc: draft.markdown, extensions: [documentReviewField] }).update({
    effects: setDocumentReview.of({ reviewId, hunks: structuredClone(draft.decisions) })
  }).state;
  const resolved = mounted.update({ effects: draft.decisions.filter(hunk => hunk.status === 'pending' || hunk.status === 'modified')
    .map(hunk => resolveReviewHunk.of({ id: hunk.id, status: 'kept' })) }).state;
  const expected = { ...draft, decisions: resolved.field(documentReviewField)!.hunks };
  return { ...expected, version: draft.version + (sameDraft(draft, expected) ? 0 : 1) };
}
export function assertSharedKeepDraft(expected: ChatProposalDraft, actual: ChatProposalDraft) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), 'Normal shared Keep checkpoint differs from independently predicted full draft');
}
export function assertSharedMountedReview(draft: ChatProposalDraft, reviewId: string, mounted: {
  connected: boolean; markdown: string; title: string | undefined;
  projection: { reviewId: string; hunks: ReviewHunkState[] } | null | undefined;
}) {
  assert(mounted.connected && reviewId.length > 0 && mounted.projection?.reviewId === reviewId, 'Mounted shared review identity or connection differs');
  assert(mounted.markdown === draft.markdown && mounted.title === draft.title &&
    JSON.stringify(mounted.projection.hunks) === JSON.stringify(draft.decisions), 'Mounted shared review differs from full acknowledged checkpoint');
}
/** Native note.rs exposes filename title and strips a matching leading H1.
 * This gate only authors synthetic bodies, so fail closed on frontmatter rather
 * than treating arbitrary metadata as independently verified authored content. */
export function expectedSharedEditorMarkdown(draft: Pick<ChatProposalDraft, 'markdown' | 'path'>) {
  const normalized = draft.markdown.replace(/\r\n/g, '\n').replace(/!\\\[\\\[/g, '![[').replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]');
  assert(!normalized.startsWith('---\n'), 'Shared synthetic draft unexpectedly contains frontmatter');
  const title = draft.path.split('/').at(-1)!.replace(/\.md$/, '');
  const lines = normalized.split('\n');
  // Rust str::lines does not retain the final empty line, but only reconstructs
  // the body when it removes a matching title heading.
  if (lines.at(-1) === '') lines.pop();
  const first = lines.findIndex(line => line.trim().length > 0);
  const heading = first < 0 ? undefined : lines[first].trim().match(/^# (.+)$/)?.[1].trim();
  const key = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (!heading || key(heading) !== key(title)) return normalized;
  lines.splice(first, 1);
  if (lines[first]?.trim() === '') lines.splice(first, 1);
  return lines.join('\n');
}
export function assertSharedPublication(plan: SharedKeepPlan, receipt: CommitNoteReviewResult, canonical: SharedCanonicalNote) {
  assert(receipt.status === 'committed' && receipt.noteId && receipt.applied?.path === plan.expectedKeepDraft.path, 'Shared receipt target or status differs from expected Keep');
  assert(plan.expectedNoteId === null || receipt.noteId === plan.expectedNoteId, 'Shared receipt changed existing Note Identity');
  assert(receipt.committedMarkdown === plan.expectedEditorMarkdown, 'Shared receipt differs from exact expected editor Markdown');
  assert(canonical.noteId === receipt.noteId && canonical.path === plan.expectedKeepDraft.path && canonical.title === plan.expectedKeepDraft.title,
    'Shared canonical identity, title or path differs from expected Keep');
  assert(canonical.markdown === plan.expectedEditorMarkdown, 'Shared canonical body differs from exact expected editor Markdown');
}
