<script lang="ts">
  import { onMount } from 'svelte';
  import { chatSettings } from '$lib/features/chat/pi/settings';
  import { writeGrantForDuration, withCreationPermission, type VaultWritePolicy } from '$lib/features/chat/pi/authority';
  import SettingsField from './SettingsField.svelte';

  let saved = $state<VaultWritePolicy | null>(null);
  let duration = $state<'off' | 'always'>('off');
  let review = $state(true);
  let create = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let message = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      saved = await chatSettings.getWriteDefaults();
      duration = saved.grant.duration;
      review = saved.reviewBeforeApplying;
      create = saved.grant.duration !== 'off' && saved.grant.operations.includes('create');
    } catch {
      error = 'Unable to load editing defaults.';
    } finally { loading = false; }
  }

  async function save() {
    if (!saved || saving) return;
    saving = true;
    error = null;
    message = null;
    try {
      const write = withCreationPermission({
        grant: writeGrantForDuration(saved, duration, 0), reviewBeforeApplying: review
      }, create) as VaultWritePolicy;
      saved = await chatSettings.setWriteDefaults(write);
      duration = saved.grant.duration;
      review = saved.reviewBeforeApplying;
      create = saved.grant.duration !== 'off' && saved.grant.operations.includes('create');
      message = 'Editing defaults saved in this vault.';
    } catch {
      error = 'Saving editing defaults could not be confirmed. Reopen Settings to check the current values.';
    } finally { saving = false; }
  }

  onMount(() => { void load(); });
</script>

<section class="settings-section" data-settings-anchor="chat-write-defaults">
  <h3 class="text-sm font-medium">Note editing defaults</h3>
  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
    Saved with this vault. Applies to new and existing chats. Review covers edits and new notes. Note read access and excluded notes still apply.
  </p>
  {#if loading}
    <p class="mt-4 text-sm text-muted-foreground">Loading editing defaults…</p>
  {:else if saved}
    <fieldset disabled={saving} class="mt-5 grid gap-4 sm:grid-cols-2" onchange={() => message = null}>
      <legend class="sr-only">Note editing defaults</legend>
      <SettingsField label="Default note editing" anchor="chat-write-access">
        <select class="settings-control" bind:value={duration}>
          <option value="off">Off — allow per chat</option>
          <option value="always">Always allow edits</option>
        </select>
      </SettingsField>
      <div data-settings-anchor="chat-write-review" class="flex items-center">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={review} />
          Review before applying edits
        </label>
      </div>
      <div data-settings-anchor="chat-write-create" class="flex items-center">
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={create} disabled={duration === 'off'} />
          Allow creating new notes
        </label>
      </div>
    </fieldset>
    <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
      Temporary permission is granted in a chat’s Vault access menu and stays with that chat.
      Turning the default off keeps those individual permissions.
    </p>
    <div class="mt-5 flex justify-end">
      <button type="button" class="h-10 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
        disabled={saving} onclick={() => void save()}>{saving ? 'Saving…' : 'Save editing defaults'}</button>
    </div>
  {:else}
    <button type="button" class="mt-4 rounded-xl border border-border px-4 py-2 text-sm" onclick={() => void load()}>Retry editing defaults</button>
  {/if}
  {#if error}<p class="mt-3 text-sm text-destructive" role="alert">{error}</p>
  {:else if message}<p class="mt-3 text-sm text-muted-foreground" role="status">{message}</p>{/if}
</section>
