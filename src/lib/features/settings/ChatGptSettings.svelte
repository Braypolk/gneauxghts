<script lang="ts">
  import { onMount } from 'svelte';
  import { chatSettings, type OpenAiAuthStatus } from '$lib/features/chat/pi/settings';

  let { onMethod, onModels }: { onMethod: (method: OpenAiAuthStatus['method']) => void; onModels: (models: string[]) => void } = $props();
  let status = $state<OpenAiAuthStatus | null>(null);
  let requestingLogin = $state(false), busy = $state(false), error = $state<string | null>(null);
  let connectionChecked = $state(false), callback = $state(''), showManual = $state(false);
  let mounted = false;
  const signingIn = $derived(requestingLogin || (!!status?.login && status.login.phase !== 'idle'));
  const progressText = $derived(status?.login?.phase === 'saving'
    ? 'Saving your connection securely…'
    : status?.login?.phase === 'completing'
      ? 'Completing sign-in…'
      : status?.login?.phase === 'waitingForBrowser'
        ? 'Finish sign-in in your browser. You can leave Settings and return here.'
        : 'Opening ChatGPT sign-in…');

  function accept(value: OpenAiAuthStatus) {
    if (!mounted) return;
    status = value;
    onMethod(value.method);
  }
  async function discover() {
    if (!mounted) return;
    connectionChecked = false;
    try {
      const models = await chatSettings.listOpenAiModels();
      if (mounted) { onModels(models.map(model => model.id)); connectionChecked = true; }
    } finally {
      // Native may have confirmed revoked/expired access while checking models.
      const auth = await chatSettings.getChatGptStatus();
      accept(auth);
      if (mounted && !auth.connected) { onModels([]); connectionChecked = false; }
    }
  }
  async function login() {
    requestingLogin = true; error = null; connectionChecked = false; showManual = false;
    try {
      accept(await chatSettings.signInWithChatGpt());
      if (mounted) await discover();
    } catch (failure) { if (mounted) error = String(failure).includes('sign-in cancelled') ? null : String(failure); }
    finally { if (mounted) requestingLogin = false; }
  }
  async function run(action: () => Promise<void>) {
    busy = true; error = null;
    try { await action(); }
    catch (failure) { if (mounted) error = String(failure); }
    finally { if (mounted) busy = false; }
  }
  async function change(method: OpenAiAuthStatus['method']) {
    await run(async () => {
      accept(await chatSettings.setOpenAiAuth(method));
      connectionChecked = false;
      if (method === 'chatgpt') await discover(); else if (mounted) onModels([]);
    });
  }
  async function disconnect() {
    await run(async () => {
      accept(await chatSettings.disconnectChatGpt());
      if (mounted) { onModels([]); connectionChecked = false; }
    });
  }
  async function submitCallback() {
    const value = callback.trim();
    callback = '';
    await run(() => chatSettings.submitChatGptCallback(value));
  }
  onMount(() => {
    mounted = true;
    let reading = false;
    async function refresh() {
      if (reading) return;
      reading = true;
      try {
        const value = await chatSettings.getChatGptStatus();
        const completed = status?.login?.phase !== 'idle' && status?.login?.phase !== undefined && value.login.phase === 'idle';
        accept(value);
        if (completed && value.connected && !value.login.error && !requestingLogin) {
          await discover();
        }
      } catch (failure) { if (mounted) error = String(failure); }
      finally { reading = false; }
    }
    void refresh();
    // Native owns the attempt. Poll its safe snapshot only while sign-in is
    // active; opening Settings never decrypts a saved credential or checks HTTP.
    const timer = setInterval(() => { if (signingIn) void refresh(); }, 500);
    return () => { mounted = false; clearInterval(timer); };
  });
</script>

<section class="settings-section" data-testid="chatgpt-sign-in" data-settings-anchor="chatgpt-sign-in">
  <h3 class="text-sm font-medium">ChatGPT subscription</h3>
  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">Connect your ChatGPT plan to use its available models and usage allowance. Your API key stays saved separately.</p>
  {#if status}
    <p class="mt-3 text-xs" data-testid="chatgpt-status">{status.connected ? 'ChatGPT connected' : 'ChatGPT not connected'} · Using {status.method === 'chatgpt' ? 'ChatGPT subscription' : 'API key'}</p>
    {#if status.supported}
      {#if signingIn}
        <p role="status" class="mt-3 text-xs text-muted-foreground">{progressText}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          {#if status.login?.browserUrl}
            <button type="button" class="settings-control" disabled={busy} onclick={() => void run(() => chatSettings.reopenChatGptSignIn())}>Open sign-in page</button>
          {/if}
          <button type="button" class="settings-control" onclick={() => void run(() => chatSettings.cancelChatGptSignIn())}>Cancel sign-in</button>
        </div>
        {#if status.login?.manualInput}
          <button type="button" class="mt-3 text-xs underline" onclick={() => showManual = !showManual}>Having trouble returning to the app?</button>
          {#if showManual}
            <form class="mt-3 flex flex-wrap gap-2" onsubmit={event => { event.preventDefault(); void submitCallback(); }}>
              <label class="w-full text-xs text-muted-foreground" for="chatgpt-callback">Paste the final callback URL from your browser after approving sign-in.</label>
              <input id="chatgpt-callback" class="settings-control min-w-0 flex-1" type="password" bind:value={callback} autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:1455/auth/callback?…" />
              <button type="submit" class="settings-control" disabled={busy || !callback.trim()}>Complete sign-in</button>
            </form>
          {/if}
        {/if}
      {:else}
        <div class="mt-3 flex flex-wrap gap-2">
          {#if !status.connected}
            <button type="button" class="settings-control" disabled={busy} onclick={() => void login()}>Continue with ChatGPT</button>
          {/if}
          {#if status.connected}
            {#if status.method === 'chatgpt'}
              <button type="button" class="settings-control" disabled={busy} onclick={() => void run(discover)}>{busy ? 'Checking…' : 'Check connection'}</button>
            {/if}
            <button type="button" class="settings-control" disabled={busy} onclick={() => void change(status!.method === 'chatgpt' ? 'apiKey' : 'chatgpt')}>{status.method === 'chatgpt' ? 'Use API key' : 'Use ChatGPT subscription'}</button>
            <button type="button" class="settings-control" disabled={busy} onclick={() => void disconnect()}>Disconnect ChatGPT</button>
          {/if}
        </div>
        {#if status.connected && status.method === 'chatgpt'}
          <p class="mt-3 text-xs text-muted-foreground" role="status">{connectionChecked ? 'Connection checked. Available models are ready.' : 'Connection saved securely on this device. Check connection to refresh available models.'}</p>
        {/if}
      {/if}
      {#if status.login?.error && !error}<p role="alert" class="mt-3 text-xs text-destructive">{status.login.error}</p>{/if}
    {:else}
      <p class="mt-3 text-xs text-muted-foreground">ChatGPT sign-in is available in the desktop app.</p>
    {/if}
  {/if}
  {#if error}<p role="alert" class="mt-3 text-xs text-destructive">{error}</p>{/if}
</section>
