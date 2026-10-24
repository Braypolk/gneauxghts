<script lang="ts">
  import { asset } from '$app/paths';
  import { appLogo, logoOptions } from '#lib/appLogo.svelte.js';
</script>

<div class="settings-section" data-settings-anchor="app-logo">
  <p class="text-sm font-medium">App logo</p>
  <p class="mt-1 text-xs text-muted-foreground">Auto follows your system, independently of the app theme.</p>
  <fieldset class="settings-theme-options">
    <legend class="sr-only">App logo preference</legend>
    {#each logoOptions as option}
      {@const theme = option.id === 'auto' ? appLogo.systemTheme : option.id}
      <label class="settings-theme-option logo-option" class:selected={appLogo.preference === option.id} title={option.description}>
        <input class="sr-only" type="radio" name="logo-preference" value={option.id}
          checked={appLogo.preference === option.id} onchange={() => appLogo.setPreference(option.id)} />
        <span class="logo-preview">
          <img src={asset(theme === 'dark' ? 'logo-dark.svg' : 'logo-light.svg')} width="64" height="64" alt="" />
        </span>
        <span class="settings-theme-caption">{option.label}</span>
      </label>
    {/each}
  </fieldset>
  {#if appLogo.error}
    <p role="alert" class="mt-3 text-xs text-destructive">{appLogo.error}</p>
    <button type="button" class="mt-2 text-xs underline" onclick={appLogo.retry}>Retry logo update</button>
  {/if}
</div>

<style>
  .logo-preview { display: flex; justify-content: center; align-items: center; height: 84px; border: 1px solid var(--border); border-radius: 9px; }
  .logo-option.selected .logo-preview { outline: 2px solid var(--foreground); outline-offset: 3px; }
  .logo-option:has(input:focus-visible) .logo-preview { outline: 2px solid var(--ring); outline-offset: 3px; }
</style>
