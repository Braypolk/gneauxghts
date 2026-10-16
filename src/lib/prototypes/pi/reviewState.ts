import type { ChatAgentProposal, ChatProposalDraft } from '$lib/features/chat/types';

export interface ReviewRecord {
  proposalJson: string; draftJson: string; decision: string; acceptedJson: string;
  receiptJson: string; receiptVersion: number; fault: string; refinementsJson?: string;
}
export const proposalOf = (value: Pick<ReviewRecord, 'proposalJson'>): ChatAgentProposal => JSON.parse(value.proposalJson);
export const draftOf = (value: Pick<ReviewRecord, 'draftJson'>): ChatProposalDraft => JSON.parse(value.draftJson);
export const unresolved = (proposal: ChatAgentProposal) => proposal.status === 'pending' || proposal.status === 'conflict';

export function requirePending(record: ReviewRecord, version?: number) {
  if (!unresolved(proposalOf(record)) || record.decision !== 'pending') throw new Error('Review already settled or Keep is in flight');
  if (version !== undefined && draftOf(record).version !== version) throw new Error('Review changed; reopen its latest checkpoint');
}

export function sameDraft(left: ChatProposalDraft, right: ChatProposalDraft) {
  return left.markdown === right.markdown && left.title === right.title && left.path === right.path
    && JSON.stringify(left.decisions) === JSON.stringify(right.decisions);
}

// This CAS is shared by editor checkpoints and model refinement. The live editor
// remains the only working-copy owner; Pi stores acknowledged drafts only.
export function acknowledgeDraft(record: ReviewRecord, draft: ChatProposalDraft, prepared?: Partial<ChatAgentProposal>) {
  requirePending(record, draft.version);
  if (record.acceptedJson) throw new Error('Retry Keep to reconcile the pending native publication before editing');
  const current = draftOf(record);
  if (!prepared && sameDraft(current, draft)) return current;
  const next = {...draft, version: current.version + 1};
  const proposal = proposalOf(record);
  if (prepared) Object.assign(proposal, prepared, {payload:{...proposal.payload,...prepared.payload}});
  proposal.title = next.title;
  proposal.suggestedPath = next.path;
  proposal.payload = {...proposal.payload, title: next.title, markdown: next.markdown};
  proposal.updatedAtMillis = Date.now();
  record.proposalJson = JSON.stringify(proposal);
  record.draftJson = JSON.stringify(next);
  return next;
}

export function acceptKeep(record: ReviewRecord, id: string, version: number, markdown: string | undefined, access: string, grants:string[] = []) {
  const proposal = proposalOf(record), draft = draftOf(record);
  if (draft.version !== version || (markdown !== undefined && markdown !== draft.markdown)) throw new Error('Keep does not match the acknowledged review');
  if (proposal.status === 'committed' && record.receiptJson && record.receiptVersion === version) return;
  if (record.decision === 'keep' && record.acceptedJson) return; // Join the same durable effect.
  requirePending(record, version);
  // An uncertain native acknowledgement retains the original exact intent.
  if (!record.acceptedJson) record.acceptedJson = JSON.stringify({id, version, kind: proposal.kind,
    noteId: proposal.noteId, path: draft.path, sourcePath: proposal.preview.notePath ?? null,
    title: draft.title, markdown: draft.markdown, baseHash: proposal.baseHash, access,grants,promotion:proposal.payload.promotion ?? null});
  record.decision = 'keep';
  record.receiptJson = '';
}
