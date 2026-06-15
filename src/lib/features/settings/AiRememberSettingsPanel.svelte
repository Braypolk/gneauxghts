<script lang="ts">
  import {
    BarChart3,
    ChevronDown,
    Link2,
    Sparkles,
    Trash2
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import {
    cleanUpApplyPolicyOptions,
    cleanUpApplyPolicyPreference,
    defaultRememberActionPreference,
    exactRememberActionLabel,
    rememberActionOptions,
    setCleanUpApplyPolicyPreference,
    setDefaultRememberActionPreference,
    setExactRememberActionLabel
  } from '$lib/appSettings';
  import {
    createAiRememberSettingsStore,
    type AiSubTab
  } from '$lib/features/settings/aiRememberSettingsStore';
  import { formatMillis, formatTimestamp } from '$lib/features/settings/formatters';
  import {
    EXACT_REMEMBER_ACTION,
    type AiProviderKind,
    type EditableRememberAction,
  } from '$lib/types/ai';

  const subTabs: { id: AiSubTab; label: string; hint: string; Icon: typeof Link2 }[] = [
    { id: 'connection', label: 'Connection', hint: 'Endpoint and API key', Icon: Link2 },
    { id: 'remember', label: 'Remember', hint: 'Defaults and custom actions', Icon: Sparkles },
    { id: 'usage', label: 'Usage', hint: 'Token statistics', Icon: BarChart3 }
  ];
  const aiRememberSettings = createAiRememberSettingsStore();

  function formatCount(value: number | null | undefined) {
    return (value ?? 0).toLocaleString();
  }

  function kindLabel(kind: EditableRememberAction['kind']) {
    return kind === 'singleNote' ? 'Single note' : 'Advanced';
  }

  onMount(() => {
    aiRememberSettings.initialize();
  });
</script>

<svelte:document onvisibilitychange={aiRememberSettings.handleVisibilityChange} />

<div class="flex flex-col gap-6">
  <nav
    class="flex flex-wrap gap-2 rounded-2xl border border-border/60 bg-muted/20 p-1.5"
    aria-label="AI settings sections"
  >
    {#each subTabs as tab}
      {@const Icon = tab.Icon}
      <button
        type="button"
        class={`flex min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors sm:px-4 ${
          $aiRememberSettings.aiSubTab === tab.id
            ? 'bg-foreground text-background shadow-sm'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        }`}
        aria-current={$aiRememberSettings.aiSubTab === tab.id ? 'page' : undefined}
        onclick={() => aiRememberSettings.setAiSubTab(tab.id)}
      >
        <span class="flex items-center gap-2">
          <Icon class="h-4 w-4 shrink-0 opacity-90" />
          {tab.label}
        </span>
        <span class="hidden pl-7 text-[11px] font-normal leading-tight opacity-80 sm:block">{tab.hint}</span>
      </button>
    {/each}
  </nav>

  {#if $aiRememberSettings.aiSubTab === 'connection'}
    <div class="space-y-5">
      <p class="text-sm text-muted-foreground">
        Point the app at any OpenAI-compatible HTTP API, then pick a model. Your key stays on this device.
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider</span>
          <select
            class="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            disabled={$aiRememberSettings.isSavingAiSettings}
            value={$aiRememberSettings.aiProviderKindInput}
            onchange={(event) =>
              aiRememberSettings.setAiProviderKindInput(
                (event.currentTarget as HTMLSelectElement).value as AiProviderKind
              )}
          >
            <option value="openAiCompatible">OpenAI-compatible HTTP</option>
            <option value="llamaServer" disabled>llama-server (coming later)</option>
          </select>
        </label>

        <div
          class="flex flex-col justify-center gap-1 rounded-2xl border border-dashed border-border/60 bg-muted/10 px-4 py-3 text-sm sm:col-span-2"
        >
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Key status</span>
          <p class="font-medium">
            {$aiRememberSettings.aiSettings?.apiKeyConfigured ? 'API key on file' : 'No API key saved yet'}
          </p>
          <p class="text-xs text-muted-foreground">
            Save a new key below to replace the stored one, or leave blank to keep the current key.
          </p>
        </div>

        <label class="flex flex-col gap-2 sm:col-span-2">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Base URL</span>
          <input
            class="w-full rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={$aiRememberSettings.aiBaseUrlInput}
            placeholder="https://api.openai.com/v1"
            disabled={$aiRememberSettings.isSavingAiSettings}
            autocomplete="off"
            oninput={(event) =>
              aiRememberSettings.setAiBaseUrlInput((event.currentTarget as HTMLInputElement).value)}
          />
        </label>

        <div class="flex flex-col gap-2 sm:col-span-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Model</span>
            <button
              class="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              type="button"
              disabled={$aiRememberSettings.isSavingAiSettings || $aiRememberSettings.isLoadingAiModels || $aiRememberSettings.aiProviderKindInput !== 'openAiCompatible'}
              onclick={() => void aiRememberSettings.loadAiModels()}
            >
              {$aiRememberSettings.isLoadingAiModels ? 'Loading…' : 'Refresh list'}
            </button>
          </div>
          <select
            class="w-full rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={$aiRememberSettings.aiModelInput}
            disabled={$aiRememberSettings.isSavingAiSettings || $aiRememberSettings.isLoadingAiModels || $aiRememberSettings.aiProviderKindInput !== 'openAiCompatible'}
            onchange={(event) =>
              aiRememberSettings.setAiModelInput((event.currentTarget as HTMLSelectElement).value)}
          >
            {#if $aiRememberSettings.aiModels.length === 0}
              <option value="">{$aiRememberSettings.aiModelsError || 'Load models from /v1/models'}</option>
            {/if}
            {#each $aiRememberSettings.aiModels as model}
              <option value={model.id}>{model.id}</option>
            {/each}
          </select>
          <p class="text-xs text-muted-foreground">
            List comes from
            <code class="rounded bg-muted/50 px-1 py-0.5 text-[11px]">
              {($aiRememberSettings.aiBaseUrlInput || 'https://api.openai.com/v1').replace(/\/$/, '')}/models
            </code>
          </p>
        </div>

        <label class="flex flex-col gap-2 sm:col-span-2">
          <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">API key</span>
          <input
            class="w-full rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            type="password"
            value={$aiRememberSettings.aiApiKeyInput}
            placeholder={$aiRememberSettings.aiSettings?.apiKeyConfigured ? 'Leave blank to keep saved key' : 'Paste API key'}
            disabled={$aiRememberSettings.isSavingAiSettings}
            autocomplete="off"
            oninput={(event) =>
              aiRememberSettings.setAiApiKeyInput((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs text-muted-foreground">Stored locally in app data.</p>
        <button
          class="inline-flex w-full items-center justify-center rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
          type="button"
          disabled={$aiRememberSettings.isSavingAiSettings}
          onclick={() => void aiRememberSettings.saveAiSettings()}
        >
          {$aiRememberSettings.isSavingAiSettings ? 'Saving…' : 'Save connection'}
        </button>
      </div>
    </div>
  {:else if $aiRememberSettings.aiSubTab === 'remember'}
    <div class="space-y-8">
      <section class="space-y-4">
        <h3 class="text-sm font-semibold">Defaults</h3>
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-2xl border border-border/70 bg-background/40 p-4">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Default remember action</p>
            <p class="mt-1 text-xs text-muted-foreground">Used when you trigger remember without picking another action.</p>
            <fieldset class="mt-4 flex flex-wrap gap-2">
              <legend class="sr-only">Default remember action</legend>
              {#each $rememberActionOptions as option}
                <label
                  title={option.description}
                  class={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    $defaultRememberActionPreference === option.id
                      ? 'border-transparent bg-foreground text-background shadow-sm'
                      : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <input
                    class="sr-only"
                    type="radio"
                    name="default-remember-action"
                    value={option.id}
                    checked={$defaultRememberActionPreference === option.id}
                    onchange={() => setDefaultRememberActionPreference(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              {/each}
            </fieldset>
            <p class="mt-3 text-xs text-muted-foreground">
              Hidden actions stay editable here but do not appear in the note menu.
            </p>
            <label class="mt-4 block space-y-1.5">
              <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Exact remember name
              </span>
              <input
                class="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                maxlength={80}
                value={$exactRememberActionLabel}
                placeholder={EXACT_REMEMBER_ACTION.label}
                aria-label="Name for the exact remember action"
                oninput={(event) =>
                  setExactRememberActionLabel((event.currentTarget as HTMLInputElement).value)}
              />
              <span class="text-[11px] text-muted-foreground">
                Shown on the remember control and menus. Clear the field to reset to “{EXACT_REMEMBER_ACTION.label}”.
              </span>
            </label>
          </div>

          <div class="rounded-2xl border border-border/70 bg-background/40 p-4">
            <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">When single-note AI edits apply</p>
            <p class="mt-1 text-xs text-muted-foreground">Controls auto-apply vs inbox for transforms on one note.</p>
            <fieldset class="mt-4 flex flex-wrap gap-2">
              <legend class="sr-only">AI edit apply policy</legend>
              {#each cleanUpApplyPolicyOptions as option}
                <label
                  title={option.description}
                  class={`cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    $cleanUpApplyPolicyPreference === option.id
                      ? 'border-transparent bg-foreground text-background shadow-sm'
                      : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <input
                    class="sr-only"
                    type="radio"
                    name="cleanup-apply-policy"
                    value={option.id}
                    checked={$cleanUpApplyPolicyPreference === option.id}
                    onchange={() => setCleanUpApplyPolicyPreference(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              {/each}
            </fieldset>
            <p class="mt-3 text-xs text-muted-foreground">
              Advanced vault actions still use Inbox approval in v1.
            </p>
          </div>
        </div>
      </section>

      <section class="space-y-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 class="text-sm font-semibold">Custom actions</h3>
            <p class="mt-1 max-w-xl text-xs text-muted-foreground">
              Built-in AI transforms and your own prompts live here. Simple actions only change the open note; advanced actions
              can reorganize your vault—use carefully.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-accent"
              type="button"
              onclick={() => aiRememberSettings.addRememberAction('singleNote')}
            >
              + Simple
            </button>
            <button
              class="rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-accent"
              type="button"
              onclick={() => aiRememberSettings.addRememberAction('advanced')}
            >
              + Advanced
            </button>
            <button
              class="rounded-full border border-border bg-foreground px-3 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              type="button"
              disabled={$aiRememberSettings.isSavingRememberActions || !$aiRememberSettings.canSaveRememberActions}
              onclick={() => void aiRememberSettings.saveRememberActions()}
            >
              {$aiRememberSettings.isSavingRememberActions ? 'Saving…' : 'Save actions'}
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-950 dark:text-amber-100">
          Custom prompts can do unexpected things. Prefer simple actions until you are confident in your prompts.
        </div>

        {#if $aiRememberSettings.rememberActionDrafts.length === 0}
          <p class="rounded-2xl border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
            No custom actions yet. Add one above.
          </p>
        {:else}
          <ul class="space-y-2" role="list">
            {#each $aiRememberSettings.rememberActionDrafts as action (action.id)}
              <li class="overflow-hidden rounded-2xl border border-border/70 bg-card/50">
                <div class="flex w-full items-center gap-2 p-3 sm:gap-3">
                  <label class="flex shrink-0 cursor-pointer items-center gap-2">
                    <span class="sr-only">Show in note menu</span>
                    <input
                      class="h-4 w-4 rounded border-border"
                      type="checkbox"
                      checked={action.visible}
                      onchange={(event) =>
                        aiRememberSettings.updateRememberAction(
                          action.id,
                          'visible',
                          (event.currentTarget as HTMLInputElement).checked
                        )}
                    />
                  </label>
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    onclick={() => aiRememberSettings.toggleExpandAction(action.id)}
                  >
                    <span class="block truncate font-medium">{action.label.trim() || 'Untitled action'}</span>
                    <span class="text-xs text-muted-foreground">{kindLabel(action.kind)}</span>
                  </button>
                  <span
                    class="hidden shrink-0 rounded-full border border-border/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline"
                  >
                    {action.visible ? 'Menu' : 'Hidden'}
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    onclick={() => aiRememberSettings.removeRememberAction(action.id)}
                    title="Remove action"
                  >
                    <Trash2 class="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    class="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted"
                    onclick={() => aiRememberSettings.toggleExpandAction(action.id)}
                    aria-expanded={$aiRememberSettings.expandedActionId === action.id}
                  >
                    <ChevronDown
                      class={`h-5 w-5 transition-transform ${$aiRememberSettings.expandedActionId === action.id ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {#if $aiRememberSettings.expandedActionId === action.id}
                  <div class="space-y-3 border-t border-border/50 bg-background/30 px-3 py-4 sm:px-4">
                    <label class="block space-y-1.5">
                      <span class="text-xs font-medium text-muted-foreground">Button label</span>
                      <input
                        class="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                        value={action.label}
                        placeholder="Shown on the remember menu"
                        oninput={(event) =>
                          aiRememberSettings.updateRememberAction(
                            action.id,
                            'label',
                            (event.currentTarget as HTMLInputElement).value
                          )}
                      />
                    </label>

                    <div class="grid gap-3 sm:grid-cols-2">
                      <label class="block space-y-1.5">
                        <span class="text-xs font-medium text-muted-foreground">Type</span>
                        <select
                          class="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none"
                          value={action.kind}
                          onchange={(event) =>
                            aiRememberSettings.updateRememberAction(
                              action.id,
                              'kind',
                              (event.currentTarget as HTMLSelectElement).value
                            )}
                        >
                          <option value="singleNote">Single note (safer)</option>
                          <option value="advanced">Advanced (vault-wide)</option>
                        </select>
                      </label>
                      <label class="block space-y-1.5">
                        <span class="text-xs font-medium text-muted-foreground">Section</span>
                        <select
                          class="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none disabled:opacity-50"
                          value={action.family}
                          disabled={action.kind === 'singleNote'}
                          onchange={(event) =>
                            aiRememberSettings.updateRememberAction(
                              action.id,
                              'family',
                              (event.currentTarget as HTMLSelectElement).value
                            )}
                        >
                          <option value="edit">Transform note</option>
                          <option value="organize">Split or organize</option>
                          <option value="integrate">Integrate into vault</option>
                        </select>
                      </label>
                    </div>

                    <label class="block space-y-1.5">
                      <span class="text-xs font-medium text-muted-foreground">Short description</span>
                      <input
                        class="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none"
                        value={action.description}
                        placeholder="Optional subtitle in the menu"
                        oninput={(event) =>
                          aiRememberSettings.updateRememberAction(
                            action.id,
                            'description',
                            (event.currentTarget as HTMLInputElement).value
                          )}
                      />
                    </label>

                    <label class="block space-y-1.5">
                      <span class="text-xs font-medium text-muted-foreground">Prompt</span>
                      <textarea
                        class="min-h-[8rem] w-full resize-y rounded-xl border border-border/60 bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
                        placeholder="What should this action do?"
                        value={action.prompt}
                        oninput={(event) =>
                          aiRememberSettings.updateRememberAction(
                            action.id,
                            'prompt',
                            (event.currentTarget as HTMLTextAreaElement).value
                          )}
                      ></textarea>
                    </label>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {:else}
    <div class="space-y-5">
      <p class="text-sm text-muted-foreground">
        Token totals from AI remember runs. Refresh after heavy use to see up-to-date numbers.
      </p>

      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          type="button"
          disabled={$aiRememberSettings.isLoadingAiDiagnostics}
          onclick={() => void aiRememberSettings.loadAiDiagnostics()}
        >
          {$aiRememberSettings.isLoadingAiDiagnostics ? 'Loading…' : 'Refresh'}
        </button>
        <button
          class="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          type="button"
          disabled={$aiRememberSettings.isClearingAiDiagnostics}
          onclick={() => void aiRememberSettings.clearAiDiagnostics()}
        >
          {$aiRememberSettings.isClearingAiDiagnostics ? 'Clearing…' : 'Clear stats'}
        </button>
      </div>

      {#if $aiRememberSettings.isLoadingAiDiagnostics && !$aiRememberSettings.aiDiagnostics}
        <p class="text-sm text-muted-foreground">Loading usage…</p>
      {:else if $aiRememberSettings.aiDiagnostics}
        {@const metrics = $aiRememberSettings.aiDiagnostics.metrics}
        <p class="text-xs text-muted-foreground">
          Snapshot: {formatTimestamp($aiRememberSettings.aiDiagnostics.capturedAtMillis)}
        </p>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-2xl border border-border/70 bg-background/50 p-4">
            <p class="text-xs uppercase tracking-wide text-muted-foreground">All-time</p>
            <p class="mt-2 text-lg font-semibold tabular-nums">{formatCount(metrics.totalTokensTotal)}</p>
            <p class="text-xs text-muted-foreground">
              in {formatCount(metrics.promptTokensTotal)} · out {formatCount(metrics.completionTokensTotal)}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">{formatCount(metrics.runCount)} runs</p>
          </div>

          <div class="rounded-2xl border border-border/70 bg-background/50 p-4">
            <p class="text-xs uppercase tracking-wide text-muted-foreground">Per run (avg)</p>
            <p class="mt-2 text-lg font-semibold tabular-nums">
              {formatCount(metrics.runCount ? Math.round(metrics.totalTokensTotal / metrics.runCount) : 0)}
            </p>
            <p class="text-xs text-muted-foreground">tokens average</p>
          </div>

          <div class="rounded-2xl border border-border/70 bg-background/50 p-4">
            <p class="text-xs uppercase tracking-wide text-muted-foreground">Largest run</p>
            <p class="mt-2 text-lg font-semibold tabular-nums">{formatCount(metrics.totalTokensMax)}</p>
            <p class="text-xs text-muted-foreground">
              in {formatCount(metrics.promptTokensMax)} · out {formatCount(metrics.completionTokensMax)}
            </p>
          </div>

          <div class="rounded-2xl border border-border/70 bg-background/50 p-4">
            <p class="text-xs uppercase tracking-wide text-muted-foreground">Latest run</p>
            {#if metrics.lastRun}
              <p class="mt-2 text-lg font-semibold tabular-nums">{formatCount(metrics.lastRun.totalTokens)}</p>
              <p class="text-xs text-muted-foreground">{metrics.lastRun.actionLabel}</p>
              <p class="text-xs text-muted-foreground">
                {metrics.lastRun.model ?? 'Unknown model'} · {formatMillis(metrics.lastRun.elapsedMillis)}
              </p>
              <p class="text-[11px] text-muted-foreground">{formatTimestamp(metrics.lastRun.updatedAtMillis)}</p>
            {:else}
              <p class="mt-3 text-sm text-muted-foreground">No runs recorded yet.</p>
            {/if}
          </div>
        </div>
      {:else}
        <p class="text-sm text-muted-foreground">No usage data yet. Run a remember action and refresh.</p>
      {/if}
    </div>
  {/if}
</div>
