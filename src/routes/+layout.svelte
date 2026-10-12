<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { workspaceTitleSlotKey } from '$lib/ui/workspaceTitleSlot';
  import { isTauriRuntime } from '$lib/tauriRuntime';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import "../app.css";
  import { initializeTheme } from '$lib/theme.svelte';
  import '$lib/editorTextSize.svelte';
  import { mobileViewport } from '$lib/ui/mobileViewport';
  import { installBackgroundPersistence } from '$lib/app/backgroundPersistence';
  import NavBar from '$lib/ui/NavBar.svelte';
  import { appStore } from '$lib/app/appStore.svelte';
  import { logDevError } from '$lib/logDevError';
  import { page } from '$app/state';
  import { getAppShellViewGeneration } from '$lib/ui/appShellNavigation.svelte';
  import { installStartupMetrics } from '$lib/e2e/startupMetrics';
  import { installBrowserE2eBackend } from '$lib/e2e/browserBackend';
  import { loadForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';
  import {
    restartLifecycle,
    type PrepareRestartReceipt
  } from '$lib/app/restartLifecycle.svelte';

  installBrowserE2eBackend();
  installStartupMetrics();
  if (import.meta.env.DEV && import.meta.env.VITE_E2E_NATIVE === 'true') {
    void import('@wdio/tauri-plugin');
  }

  let { children } = $props();
  let shellViewKey = $derived(`${page.url.pathname}::${getAppShellViewGeneration()}`);

  let nativeWindowControlsHeight = $state(0);
  let nativeWindowControlsWidth = $state(0);
  let workspaceTitleSlot = $state<HTMLDivElement | null>(null);
  setContext(workspaceTitleSlotKey, () => workspaceTitleSlot);

  onMount(() => {
    const disposeBackgroundPersistence = installBackgroundPersistence();
    if (isTauriRuntime() && import.meta.env.VITE_E2E_BROWSER !== 'true' && /Mac/i.test(navigator.platform)) {
      nativeWindowControlsHeight = 32;
      nativeWindowControlsWidth = 84;
    }
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    void Promise.allSettled([
      listen('app://restart-preparing', () => restartLifecycle.observeBackendPreparing()),
      listen<PrepareRestartReceipt>('app://restart-prepared', ({ payload }) =>
        restartLifecycle.observeBackendReceipt(payload)
      )
    ]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          logDevError('[RestartLifecycle] lifecycle event listener setup failed', result.reason);
        } else if (disposed) {
          result.value();
        } else {
          unlisteners.push(result.value);
        }
      }
    });
    void initializeTheme();
    void loadForgottenNoteRetentionPreference().catch(() => undefined);
    // Bootstrap the unified AppStore once at the layout level so backend
    // events have a single subscriber and feature stores can read
    // vault/semantic/AI snapshots from one place.
    void appStore.bootstrap().catch((error) => {
      logDevError('[AppStore] bootstrap failed; retry is required before editing', error);
    });
    return () => {
      disposeBackgroundPersistence();
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  });
</script>

<div
  use:mobileViewport
  style={`--native-window-controls-height: ${nativeWindowControlsHeight}px; --native-window-controls-width: ${nativeWindowControlsWidth}px;`}
  class="app-shell relative flex h-(--app-shell-height) min-h-(--app-shell-height) flex-col overflow-hidden bg-background text-foreground"
>
  <div data-tauri-drag-region class="compact-window-drag-region"></div>
  <div bind:this={workspaceTitleSlot} class="mobile-workspace-title-slot" inert={restartLifecycle.workspaceMutationsBlocked}></div>
  <div inert={restartLifecycle.workspaceMutationsBlocked}>
    <NavBar />
  </div>
  <div
    class="flex-1 min-h-0 overflow-hidden px-0 sm:px-4"
    inert={restartLifecycle.workspaceMutationsBlocked}
  >
    {#key shellViewKey}
      {@render children()}
    {/key}
  </div>
  {#if restartLifecycle.workspaceMutationsBlocked}
    <div class="absolute inset-0 z-50 flex items-center justify-center bg-background/85 px-6 backdrop-blur-sm">
      <div class="w-full max-w-md rounded-3xl border border-border bg-background p-6 text-center shadow-xl" role="status">
        <p class="text-base font-medium">
          {restartLifecycle.phase === 'preparing'
            ? 'Preparing restart…'
            : restartLifecycle.phase === 'readyToRestart'
              ? 'Ready to restart'
              : 'Restart needs attention'}
        </p>
        {#if restartLifecycle.error}
          <p class="mt-2 text-sm text-destructive">{restartLifecycle.error}</p>
        {/if}
        {#if restartLifecycle.phase !== 'preparing'}
          <button
            class="mt-4 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
            type="button"
            onclick={() => void restartLifecycle.restart()}
          >
            Retry Restart
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .app-shell {
    --app-shell-top-inset: env(safe-area-inset-top, 0px);
    padding-top: var(--app-shell-top-inset);
  }
  .compact-window-drag-region { display: none; }
  .mobile-workspace-title-slot { display: none; }
  @media (max-width: 639px) {
    .app-shell {
      --app-shell-top-inset: calc(env(safe-area-inset-top, 0px) + var(--native-window-controls-height, 0px));
    }
    .app-shell:has(:global(.notepad-shell)) {
      --app-shell-top-inset: calc(env(safe-area-inset-top, 0px) + max(2.75rem, var(--native-window-controls-height, 0px)));
      /* Let pane content scroll behind one backdrop all the way to the top. */
      padding-top: 0;
    }
    .app-shell:has(:global(.notepad-shell)) .mobile-workspace-title-slot {
      display: flex;
      position: absolute;
      inset: env(safe-area-inset-top, 0px) 0 auto;
      height: max(2.75rem, var(--native-window-controls-height, 0px));
      /* Reserve matching space on both sides to center the title in the window. */
      padding: 0 calc(0.75rem + var(--native-window-controls-width, 0px));
      z-index: 45;
      pointer-events: none;
    }
    .compact-window-drag-region {
      display: block;
      position: absolute;
      inset: 0 0 auto;
      height: var(--app-shell-top-inset);
      z-index: 40;
    }
  }
</style>
