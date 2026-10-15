<script lang="ts">
  import { FileInput } from '@lucide/svelte';
  import ProposedChangesCard from '$lib/features/proposals/ProposedChangesCard.svelte';
  import type { ProposalReviewSessionSnapshot } from '$lib/features/proposals/types';
  import type { ChatController } from '../controller.svelte';
  import type { ChatAgentProposal } from '../types';

  interface Props {
    controller: ChatController;
    proposals: ChatAgentProposal[];
    visibleProposalSnapshot: ProposalReviewSessionSnapshot | null;
    onProposalKeepAll?: () => void | Promise<void>;
    onProposalUndoAll?: () => void | Promise<void>;
    onProposalReview?: () => void | Promise<void>;
    onProposalRetry?: () => void | Promise<void>;
    onProposalCopyCurrent?: () => void | Promise<void>;
    onProposalReloadDisk?: () => void | Promise<void>;
    onReviewAgentProposal?: (
      proposal: ChatAgentProposal
    ) => void | Promise<void>;
  }

  let {
    controller,
    proposals,
    visibleProposalSnapshot,
    onProposalKeepAll,
    onProposalUndoAll,
    onProposalReview,
    onProposalRetry,
    onProposalCopyCurrent,
    onProposalReloadDisk,
    onReviewAgentProposal
  }: Props = $props();

  const proposalsAwaitingReview = $derived(proposals.filter(proposal => visibleProposalSnapshot?.proposalId !== proposal.id));

  async function dismissAgentProposal(proposal: ChatAgentProposal) {
    await controller.dismissProposal(proposal.id);
  }
</script>

{#if proposalsAwaitingReview.length > 0}
  <div class="pt-2" aria-label="Pending note proposals">
    <div class="chat-content-lane max-h-[45vh] space-y-2 overflow-y-auto">
      {#each proposalsAwaitingReview as proposal (proposal.id)}
        <section data-proposal-id={proposal.id} class="rounded-2xl border border-border bg-background/95 p-3 shadow-sm">
          <div class="mb-2 flex items-center gap-2">
            <FileInput class="h-4 w-4 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">
                {proposal.kind === 'create' ? 'Create' : 'Update'}
                “{proposal.title}”
              </p>
              <p class="text-[11px] text-muted-foreground">
                Review required before writing
              </p>
            </div>
          </div>

          <p class="rounded-xl bg-muted/35 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            Open in the note editor to review before applying.
          </p>
          <div class="mt-2 flex justify-end gap-2">
            <button type="button" class="rounded-full px-3 py-1.5 text-xs" onclick={() => void dismissAgentProposal(proposal)}>Discard</button>
            <button type="button" class="rounded-full bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-50"
              disabled={!onReviewAgentProposal} onclick={() => void onReviewAgentProposal?.(proposal)}>Review in editor</button>
          </div>
        </section>
      {/each}
    </div>
  </div>
{/if}

{#if visibleProposalSnapshot != null}
  <ProposedChangesCard
    snapshot={visibleProposalSnapshot}
    onKeepAll={onProposalKeepAll ?? (() => {})}
    onUndoAll={onProposalUndoAll ?? (() => {})}
    onReview={onProposalReview ?? (() => {})}
    onRetry={onProposalRetry}
    onCopyCurrent={onProposalCopyCurrent}
    onReloadDisk={onProposalReloadDisk}
  />
{/if}

<style>
  @media (any-pointer: coarse) {
    button {
      min-width: 44px;
      min-height: 44px;
    }
  }
</style>
