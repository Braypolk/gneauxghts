<script lang="ts">
  interface BlockHandleRefs {
    content: HTMLDivElement;
    addButton: HTMLButtonElement;
    dragButton: HTMLButtonElement;
  }

  interface Props {
    onReady?: (refs: BlockHandleRefs) => void;
  }

  let { onReady }: Props = $props();

  let content = $state<HTMLDivElement | null>(null);
  let addButton = $state<HTMLButtonElement | null>(null);
  let dragButton = $state<HTMLButtonElement | null>(null);

  let readySent = false;

  $effect.pre(() => {
    if (readySent || !content || !addButton || !dragButton) {
      return;
    }
    readySent = true;
    onReady?.({ content, addButton, dragButton });
  });

  const addIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
`;

  const dragHandleIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="7.25" cy="5.9" r="1.4" />
    <circle cx="7.25" cy="12" r="1.4" />
    <circle cx="7.25" cy="18.1" r="1.4" />
    <circle cx="16.75" cy="5.9" r="1.4" />
    <circle cx="16.75" cy="12" r="1.4" />
    <circle cx="16.75" cy="18.1" r="1.4" />
  </svg>
`;
</script>

<div
  bind:this={content}
  class="notepad-block-handle"
  data-show="false"
  data-dragging="false"
  style="position: absolute"
>
  <button
    type="button"
    bind:this={addButton}
    class="notepad-block-handle__action"
    data-role="add"
    aria-label="Insert block"
  >
    {@html addIcon}
  </button>
  <button
    type="button"
    bind:this={dragButton}
    class="notepad-block-handle__action"
    data-role="drag"
    aria-label="Move block"
  >
    {@html dragHandleIcon}
  </button>
</div>

<style>
  .notepad-block-handle {
    position: absolute;
    z-index: 80;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    pointer-events: auto;
    color: color-mix(in oklab, var(--foreground) 78%, var(--muted-foreground) 22%);
  }

  /* visibility (not display:none) so getBoundingClientRect stays valid for Floating UI when the slash menu is anchored to this handle */
  .notepad-block-handle[data-show='false'] {
    visibility: hidden;
    pointer-events: none;
  }

  .notepad-block-handle__action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    margin: 0;
    padding: 0;
    border-radius: 999px;
    border: 1px solid color-mix(in oklab, var(--border) 82%, var(--foreground) 18%);
    background: color-mix(in oklab, var(--card) 94%, var(--background));
    color: inherit;
    cursor: pointer;
  }

  .notepad-block-handle__action :global(svg) {
    display: block;
    width: 1.15rem;
    height: 1.15rem;
  }

  .notepad-block-handle__action:global(.active) {
    background: color-mix(in oklab, var(--accent) 22%, var(--background));
  }
</style>
