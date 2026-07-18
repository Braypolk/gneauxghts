<script lang="ts">
  import {
    BODY_SIZE_MAX_REM,
    BODY_SIZE_MIN_REM,
    BODY_SIZE_STEP_REM,
    editorTextSizeCustom,
    editorTextSizeOptions,
    editorTextSizePreference,
    formatHeadingScaleLabel,
    formatRemLabel,
    HEADING_SCALE_MAX,
    HEADING_SCALE_MIN,
    HEADING_SCALE_STEP,
    resolveEditorTextSizes,
    setEditorTextSizeCustom,
    setEditorTextSizePreference
  } from '$lib/editorTextSize';

  const resolvedSizes = $derived(
    resolveEditorTextSizes($editorTextSizePreference, $editorTextSizeCustom)
  );

  function handleBodySizeInput(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    setEditorTextSizeCustom({
      bodyRem: Number(target.value),
      headingScale: $editorTextSizeCustom.headingScale
    });
  }

  function handleHeadingScaleInput(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;
    setEditorTextSizeCustom({
      bodyRem: $editorTextSizeCustom.bodyRem,
      headingScale: Number(target.value)
    });
  }
</script>

<div class="settings-section">
  <div class="flex flex-col gap-4">
    <div>
      <p class="text-sm font-medium">Editor text size</p>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Scales body text and headings in the notepad. Medium matches the current default.
      </p>
    </div>

    <fieldset class="flex flex-wrap gap-2">
      <legend class="sr-only">Editor text size</legend>

      {#each editorTextSizeOptions as option (option.id)}
        <label
          title={option.description}
          class={`cursor-pointer rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
            $editorTextSizePreference === option.id
              ? 'border-border bg-foreground text-background shadow-sm'
              : 'border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          }`}
        >
          <input
            class="sr-only"
            type="radio"
            name="editor-text-size"
            value={option.id}
            checked={$editorTextSizePreference === option.id}
            onchange={() => setEditorTextSizePreference(option.id)}
          />
          <span>{option.label}</span>
        </label>
      {/each}
    </fieldset>
  </div>

  {#if $editorTextSizePreference === 'custom'}
    <div class="mt-5 grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
      <label class="grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium">Body text</span>
          <span class="text-xs tabular-nums text-muted-foreground">
            {formatRemLabel($editorTextSizeCustom.bodyRem)}
          </span>
        </div>
        <input
          class="w-full accent-foreground"
          type="range"
          min={BODY_SIZE_MIN_REM}
          max={BODY_SIZE_MAX_REM}
          step={BODY_SIZE_STEP_REM}
          value={$editorTextSizeCustom.bodyRem}
          oninput={handleBodySizeInput}
        />
        <p class="text-xs text-muted-foreground">Paragraph and list text size.</p>
      </label>

      <label class="grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium">Heading scale</span>
          <span class="text-xs tabular-nums text-muted-foreground">
            {formatHeadingScaleLabel($editorTextSizeCustom.headingScale)}
          </span>
        </div>
        <input
          class="w-full accent-foreground"
          type="range"
          min={HEADING_SCALE_MIN}
          max={HEADING_SCALE_MAX}
          step={HEADING_SCALE_STEP}
          value={$editorTextSizeCustom.headingScale}
          oninput={handleHeadingScaleInput}
        />
        <p class="text-xs text-muted-foreground">
          Relative to body size. 100% keeps medium heading proportions.
        </p>
      </label>
    </div>
  {/if}

  <div
    class="mt-5 border-t border-border/60 pt-5"
    style:font-size="{resolvedSizes.bodyRem}rem"
    aria-hidden="true"
  >
    <p class="text-xs text-muted-foreground">Preview</p>
    <p class="mt-3 font-bold leading-tight" style:font-size="{resolvedSizes.h1Rem}rem">Heading 1</p>
    <p class="mt-2 font-bold leading-tight" style:font-size="{resolvedSizes.h2Rem}rem">Heading 2</p>
    <p class="mt-2 font-bold leading-snug" style:font-size="{resolvedSizes.h3Rem}rem">Heading 3</p>
    <p class="mt-3 leading-relaxed text-foreground/90">
      Body text looks like this in the editor.
    </p>
  </div>
</div>
