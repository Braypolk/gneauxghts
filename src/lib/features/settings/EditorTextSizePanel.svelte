<script lang="ts">
  import {
    BODY_SIZE_MAX_REM,
    BODY_SIZE_MIN_REM,
    BODY_SIZE_STEP_REM,
    editorTextSize,
    editorTextSizeOptions,
    formatHeadingScaleLabel,
    formatRemLabel,
    HEADING_SCALE_MAX,
    HEADING_SCALE_MIN,
    HEADING_SCALE_STEP,
    resolveEditorTextSizes,
    setEditorTextSizeCustom,
    setEditorTextSizePreference
  } from '$lib/editorTextSize.svelte';

  const resolvedSizes = $derived(
    resolveEditorTextSizes(editorTextSize.preference, editorTextSize.custom)
  );

  function handleBodySizeInput(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    setEditorTextSizeCustom({
      bodyRem: Number(target.value),
      headingScale: editorTextSize.custom.headingScale
    });
  }

  function handleHeadingScaleInput(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    setEditorTextSizeCustom({
      bodyRem: editorTextSize.custom.bodyRem,
      headingScale: Number(target.value)
    });
  }
</script>

<div class="settings-section" data-settings-anchor="text-size">
  <div class="flex flex-col gap-4">
    <div>
      <p class="text-sm font-medium">Editor text size</p>
    </div>

    <fieldset class="flex flex-wrap gap-2">
      <legend class="sr-only">Editor text size</legend>

      {#each editorTextSizeOptions as option (option.id)}
        <label
          title={option.description}
          class={`cursor-pointer rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
            editorTextSize.preference === option.id
              ? 'border-border bg-foreground text-background shadow-sm'
              : 'border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          }`}
        >
          <input
            class="sr-only"
            type="radio"
            name="editor-text-size"
            value={option.id}
            checked={editorTextSize.preference === option.id}
            onchange={() => setEditorTextSizePreference(option.id)}
          />
          <span>{option.label}</span>
        </label>
      {/each}
    </fieldset>
  </div>

  {#if editorTextSize.preference === 'custom'}
    <div class="mt-5 grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
      <label class="grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium">Body text</span>
          <span class="text-xs tabular-nums text-muted-foreground">
            {formatRemLabel(editorTextSize.custom.bodyRem)}
          </span>
        </div>
        <input
          class="w-full accent-foreground"
          type="range"
          min={BODY_SIZE_MIN_REM}
          max={BODY_SIZE_MAX_REM}
          step={BODY_SIZE_STEP_REM}
          value={editorTextSize.custom.bodyRem}
          oninput={handleBodySizeInput}
        />
      </label>

      <label class="grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium">Heading scale</span>
          <span class="text-xs tabular-nums text-muted-foreground">
            {formatHeadingScaleLabel(editorTextSize.custom.headingScale)}
          </span>
        </div>
        <input
          class="w-full accent-foreground"
          type="range"
          min={HEADING_SCALE_MIN}
          max={HEADING_SCALE_MAX}
          step={HEADING_SCALE_STEP}
          value={editorTextSize.custom.headingScale}
          oninput={handleHeadingScaleInput}
        />
        <p class="text-xs text-muted-foreground">
          100% uses the default heading proportions.
        </p>
      </label>
    </div>
  {/if}

  <div
    class="mt-4 rounded-lg bg-muted/30 px-5 py-4"
    style:font-size="{resolvedSizes.bodyRem}rem"
    aria-hidden="true"
  >
    <p class="font-bold leading-tight" style:font-size="{resolvedSizes.h1Rem}rem">Room to think.</p>
    {#if editorTextSize.preference === 'custom'}
    <p class="mt-2 font-bold leading-tight" style:font-size="{resolvedSizes.h2Rem}rem">A space for your ideas</p>
    <p class="mt-2 font-bold leading-snug" style:font-size="{resolvedSizes.h3Rem}rem">One thought at a time</p>
    {/if}
    <p class="mt-3 leading-relaxed text-foreground/90">
      A place for your notes, ideas, and connections.
    </p>
  </div>
</div>
