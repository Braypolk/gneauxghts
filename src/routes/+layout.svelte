<script lang="ts">
  import { onMount } from 'svelte';
  import "../app.css";
  import { initializeTheme } from '$lib/theme.svelte';
  import '$lib/editorTextSize.svelte';
  import { mobileViewport } from '$lib/ui/mobileViewport';
  import NavBar from '$lib/ui/NavBar.svelte';
  import { appStore } from '$lib/app/appStore.svelte';
  import { logDevError } from '$lib/logDevError';
  import { page } from '$app/state';
  import { getAppShellViewGeneration } from '$lib/ui/appShellNavigation.svelte';
  import { installBrowserE2eBackend } from '$lib/e2e/browserBackend';
  import { loadForgottenNoteRetentionPreference } from '$lib/appSettings.svelte';

  installBrowserE2eBackend();
  if (import.meta.env.DEV && import.meta.env.VITE_E2E_NATIVE === 'true') {
    void import('@wdio/tauri-plugin');
  }

  let { children } = $props();
  let shellViewKey = $derived(`${page.url.pathname}::${getAppShellViewGeneration()}`);

  onMount(() => {
    void initializeTheme();
    void loadForgottenNoteRetentionPreference().catch(() => undefined);
    // Bootstrap the unified AppStore once at the layout level so backend
    // events have a single subscriber and feature stores can read
    // vault/semantic/AI snapshots from one place.
    void appStore.bootstrap().catch((error) => {
      logDevError('[AppStore] bootstrap failed; feature stores will fall back to per-feature loads', error);
    });
  });
</script>

<div
  use:mobileViewport
  class="relative flex h-(--app-shell-height) min-h-(--app-shell-height) flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top,0px)] text-foreground"
>
  <NavBar />
  <div class="flex-1 min-h-0 overflow-hidden px-0 sm:px-4">
    {#key shellViewKey}
      {@render children()}
    {/key}
  </div>
</div>
