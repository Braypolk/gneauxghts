<script lang="ts">
  import type { EditReview } from '../pi/publication';
  import { editDiffLayout } from '$lib/editDiffLayout.svelte';
  import { editReviewChanges } from './editReviewChanges';
  let { review, disabled = false, onDecision }: { review: EditReview; disabled?: boolean; onDecision: (decision: 'approved' | 'rejected') => Promise<unknown> } = $props();
  let deciding = $state(false);
  const changes = $derived(review.kind === 'edit' ? editReviewChanges(review.patch) : null);
  function blankLines(parts: Array<{ text: string }>) {
    const text = parts.map(part => part.text).join('');
    return /^\n+$/.test(text) ? text.length : 0;
  }
  function visibleSpacing(text: string, show: boolean) {
    return show ? text.replace(/ /g, '·').replace(/\t/g, '⇥').replace(/\u00a0/g, '⍽').replace(/\n/g, '↵\n') : text;
  }
  async function decide(decision: 'approved' | 'rejected') {
    deciding = true;
    try { await onDecision(decision); } finally { deciding = false; }
  }
</script>
<section aria-label={`${review.kind === 'create' ? 'Review creation of' : 'Review edit to'} ${review.title}`} class="edit-review" data-testid="pi-edit-review">
  <h3>{review.kind === 'create' ? 'Create' : 'Changes to'} {review.title}</h3>
  {#if review.kind === 'create'}
    <p>Review this new note before saving it.</p>
    <p>Destination: {review.destination}</p>
    <div class="version text new-note" aria-label="New note content">{review.markdown}</div>
  {:else}
  <p>Review these changes before applying them to the saved note.</p>
  {#if changes}
    <div aria-label="Proposed changes" class="changes" data-layout={editDiffLayout.preference}>
      {#if editDiffLayout.preference === 'inline'}
        <div class="legend"><span class="removed">Removed</span><span class="added">Added</span></div>
      {/if}
      {#each changes as change, index}
        <div class="change">
          {#if changes.length > 1}<p class="change-number">Change {index + 1} of {changes.length}</p>{/if}
          {#if change.context}<div class="context"><span>Nearby text</span><div class="text">{change.context}</div></div>{/if}
          {#if change.spacingChanged}<p>Spacing or line breaks changed.</p><p class="spacing-key">Spaces: · &nbsp; Tabs: ⇥ &nbsp; Line breaks: ↵ &nbsp; Nonbreaking spaces: ⍽</p>{/if}
          {#if editDiffLayout.preference === 'inline'}
            <div class="version text" data-testid="pi-edit-inline">
              {#each change.inline as part}{@const blank = blankLines([part])}{#if part.kind === 'removed'}<del class="removed">{#if blank}<span class="empty">{blank === 1 ? 'Blank line' : `${blank} blank lines`}</span>{:else}{visibleSpacing(part.text, change.spacingChanged)}{/if}</del>{:else if part.kind === 'added'}<ins class="added">{#if blank}<span class="empty">{blank === 1 ? 'Blank line' : `${blank} blank lines`}</span>{:else}{visibleSpacing(part.text, change.spacingChanged)}{/if}</ins>{:else}{part.text}{/if}{/each}
            </div>
          {:else}
            <div class="comparison">
            {#each ['before', 'after'] as side}
              {@const parts = change[side as 'before' | 'after']}
              {@const blank = blankLines(parts)}
              <div class="version {side}">
                <h4>{side === 'before' ? 'Before' : 'After'}</h4>
                <div class="text" data-testid={`pi-edit-${side}`}>
                  {#if blank}<span class="empty">{blank === 1 ? 'Blank line' : `${blank} blank lines`}</span>{:else}{#each parts as part}{#if part.changed}<mark>{visibleSpacing(part.text, change.spacingChanged)}</mark>{:else}{part.text}{/if}{:else}<span class="empty">No text</span>{/each}{/if}
                </div>
              </div>
            {/each}
          </div>
          {/if}
        </div>
      {/each}
    </div>
    <details><summary>Show technical diff</summary><pre>{review.patch}</pre></details>
  {:else}
    <p>Review the detailed changes below.</p>
    <pre aria-label="Proposed changes">{review.patch}</pre>
  {/if}
  {/if}
  <div class="actions">
    <button type="button" disabled={disabled || deciding || review.decision !== 'pending'} onclick={() => decide('rejected')}>{review.kind === 'create' ? 'Discard creation' : 'Discard edit'}</button>
    <button type="button" disabled={disabled || deciding || review.decision !== 'pending'} onclick={() => decide('approved')}>{review.kind === 'create' ? 'Create note' : 'Apply edit'}</button>
  </div>
</section>
<style>
  .edit-review { container-type: inline-size; margin-block: 1rem; padding: 1rem; border: 1px solid var(--border); border-radius: .7rem; }
  h3 { font-weight: 600; }
  p { margin-block: .5rem; font-size: .85rem; color: var(--muted-foreground); }
  pre { max-height: 22rem; overflow: auto; font-size: .8rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .new-note { max-height: 28rem; overflow: auto; }
  .changes { display: grid; gap: 1rem; margin-block: 1rem; max-height: 28rem; overflow: auto; }
  .comparison { display: grid; gap: .5rem; }
  .version { min-width: 0; padding: .75rem; border: 1px solid var(--border); border-radius: .4rem; }
  h4 { margin-bottom: .4rem; color: var(--muted-foreground); font-size: .75rem; font-weight: 600; }
  .text { font-size: .9rem; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
  mark, del, ins { border-radius: .15rem; color: inherit; padding-block: .1rem; }
  .before mark, .removed { background: color-mix(in srgb, #ef4444 18%, transparent); text-decoration: line-through; text-decoration-color: color-mix(in srgb, #ef4444 65%, currentColor); }
  .after mark, .added { background: color-mix(in srgb, #22c55e 22%, transparent); font-weight: 600; text-decoration: none; }
  del + ins { margin-inline-start: .3em; }
  .legend { display: flex; gap: .75rem; font-size: .75rem; color: var(--muted-foreground); }
  .legend span { border-radius: .15rem; padding-inline: .25rem; }
  .empty { color: var(--muted-foreground); font-style: italic; }
  .change-number { margin-top: 0; font-size: .75rem; }
  .context { margin-bottom: .5rem; color: var(--muted-foreground); }
  .context > span, .spacing-key { font-size: .75rem; }
  details { margin-top: .75rem; }
  summary { width: fit-content; cursor: pointer; color: var(--muted-foreground); font-size: .75rem; }
  details pre { margin-top: .5rem; }
  @container (min-width: 34rem) { .comparison { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
  .actions { display: flex; justify-content: flex-end; gap: 1rem; margin-top: .75rem; }
  button { padding: .4rem .7rem; border: 1px solid var(--border); border-radius: .4rem; font-size: .85rem; }
  button:disabled { opacity: .4; }
</style>
