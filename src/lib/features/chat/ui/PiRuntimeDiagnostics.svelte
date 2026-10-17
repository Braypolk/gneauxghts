<script lang="ts">
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import type { ConversationId } from '@earendil-works/pi-durable';
  import type { PiDiagnostics, PiDiagnosticSnapshot } from '../pi/diagnostics';
  let { diagnostics, conversationId }: { diagnostics?: PiDiagnostics; conversationId?: ConversationId } = $props();
  const empty: PiDiagnosticSnapshot = { state: 'open', notices: [] };
  let snapshot = $state<PiDiagnosticSnapshot>(untrack(() => diagnostics ? get(diagnostics) : empty));
  $effect(() => {
    snapshot = empty;
    return diagnostics?.subscribe(value => { snapshot = value; });
  });
  const notices = $derived(snapshot.notices.filter(item => item.conversationId === undefined || item.conversationId === conversationId));
</script>

{#if notices.length}
  <div class="pi-runtime-diagnostics" aria-label="Chat diagnostics" data-testid="pi-runtime-diagnostics">
    {#each notices as notice (`${notice.code}:${notice.conversationId ?? 'runtime'}`)}
      <div class:error={notice.severity === 'error'} role={notice.severity === 'error' ? 'alert' : 'status'} data-diagnostic-code={notice.code}>
        <span>{notice.conversationId === undefined ? 'Chat: ' : ''}{notice.message}{notice.count > 1 ? ` (${notice.count} reports)` : ''}</span>
        {#if snapshot.state === 'open'}<button type="button" aria-label="Dismiss chat diagnostic" onclick={() => diagnostics?.dismiss(notice.code, notice.conversationId)}>Dismiss</button>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .pi-runtime-diagnostics { padding: .5rem 1rem; font-size: .8rem; color: var(--muted-foreground); }
  .pi-runtime-diagnostics > div { display: flex; align-items: baseline; gap: .5rem; justify-content: space-between; }
  .error { color: var(--destructive); }
  button { flex-shrink: 0; text-decoration: underline; }
</style>
