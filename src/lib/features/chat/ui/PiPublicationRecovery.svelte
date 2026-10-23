<script lang="ts">
  import { onMount } from 'svelte';
  import { retryPublicationAdoption, subscribePublicationAdoptionRecovery, type PublicationAdoptionRecovery } from '../pi/publication';
  let recovery = $state<PublicationAdoptionRecovery | null>(null);
  onMount(() => subscribePublicationAdoptionRecovery(value => { recovery = value; }));
  async function retry() {
    try { await retryPublicationAdoption(); } catch { /* The retained recovery state presents the retry error. */ }
  }
</script>

{#if recovery}
  <div role="status" class="publication-recovery" data-testid="pi-publication-recovery">
    <p>{recovery.message}</p>
    <p class="detail">{recovery.error}</p>
    <button type="button" disabled={recovery.retrying} onclick={retry}>{recovery.retrying ? 'Checking saved location…' : recovery.retryLabel}</button>
  </div>
{/if}

<style>
  .publication-recovery { position: absolute; z-index: 60; inset: calc(var(--app-shell-top-inset, 0px) + .6rem) .6rem auto; max-height: min(22rem, 65dvh); overflow-y: auto; padding: .75rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--background); font-size: .85rem; box-shadow: 0 .5rem 1.5rem #0002; }
  p { margin-block: .25rem; }
  .detail { color: var(--muted-foreground); font-size: .75rem; overflow-wrap: anywhere; }
  button { margin-top: .4rem; padding: .35rem .6rem; border: 1px solid var(--border); border-radius: .3rem; }
  button:disabled { opacity: .5; }
</style>
