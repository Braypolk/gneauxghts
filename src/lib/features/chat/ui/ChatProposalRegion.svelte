<script lang="ts">
  import { FileInput } from '@lucide/svelte';
  import ProposedChangesCard from '$lib/features/proposals/ProposedChangesCard.svelte';
  import type { ProposalReviewSessionSnapshot } from '$lib/features/proposals/types';
  import type { ChatController } from '../controller.svelte';
  import type { ChatAgentProposal } from '../types';
  import { proposalInitialMarkdown } from './chatPanelHelpers';

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

  let proposalDrafts = $state<Record<string, string>>({});

  const proposalsAwaitingReview = $derived.by(() =>
    proposals.filter((proposal) => !proposalIsOpenInEditor(proposal))
  );

  function proposalMarkdown(proposal: ChatAgentProposal) {
    return proposalDrafts[proposal.id] ?? proposalInitialMarkdown(proposal);
  }

  function proposalIsOpenInEditor(proposal: ChatAgentProposal) {
    if (proposal.kind !== 'update') return false;
    return (
      visibleProposalSnapshot?.proposalId === proposal.id
    );
  }

  async function keepAgentProposal(proposal: ChatAgentProposal) {
    await controller.keepProposal(proposal.id, proposalMarkdown(proposal));
  }

  async function dismissAgentProposal(proposal: ChatAgentProposal) {
    await controller.dismissProposal(proposal.id);
  }
</script>

{#if proposalsAwaitingReview.length > 0}
  <div class="pt-2" aria-label="Pending note proposals">
    <div class="chat-content-lane max-h-[45vh] space-y-2 overflow-y-auto">
      {#each proposalsAwaitingReview as proposal (proposal.id)}
        <section class="rounded-2xl border border-border bg-background/95 p-3 shadow-sm">
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

          {#if proposal.kind === 'create'}
            <textarea
              class="block max-h-52 min-h-28 w-full resize-y rounded-xl border border-border bg-muted/20 p-2 font-mono text-xs leading-5 outline-none focus:border-foreground/25"
              value={proposalMarkdown(proposal)}
              oninput={(event) => {
                proposalDrafts = {
                  ...proposalDrafts,
                  [proposal.id]: (event.currentTarget as HTMLTextAreaElement).value
                };
              }}
              aria-label={`Proposed Markdown for ${proposal.title}`}
            ></textarea>
            <div class="mt-2 flex justify-end gap-2">
              <button
                type="button"
                class="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                onclick={() => void dismissAgentProposal(proposal)}
              >
                Undo
              </button>
              <button
                type="button"
                class="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                onclick={() => void keepAgentProposal(proposal)}
              >
                Keep
              </button>
            </div>
          {:else}
            <p class="rounded-xl bg-muted/35 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              Open this update in the note editor to review its highlighted changes
              before applying it.
            </p>
            <div class="mt-2 flex justify-end gap-2">
              <button
                type="button"
                class="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                onclick={() => void dismissAgentProposal(proposal)}
              >
                Undo
              </button>
              <button
                type="button"
                class="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                disabled={!onReviewAgentProposal}
                onclick={() => void onReviewAgentProposal?.(proposal)}
              >
                Review in editor
              </button>
            </div>
          {/if}
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
