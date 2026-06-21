<script lang="ts">
  import { untrack } from 'svelte';

  import { createMergeDiffView, type MergeDiffHandle } from './mergeDiffView';

  interface Props {
    /** Current note text (the "old" side). */
    original: string;
    /** Proposed note text (the "new" side). */
    proposed: string;
    /** Collapse unchanged stretches to show changed regions only. */
    collapseUnchanged?: boolean;
    /** Optional cap on visible height; scrolls past it. */
    maxHeightClass?: string;
  }

  let {
    original,
    proposed,
    collapseUnchanged = false,
    maxHeightClass = 'max-h-[32rem]'
  }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let handle: MergeDiffHandle | null = null;

  // Mount/teardown is tied to the host element ONLY. The initial content is read
  // via untrack so this effect does not re-run (and tear down the view) when the
  // diff text changes — that path is handled by the update effect below. Returning
  // the cleanup guarantees view.destroy() runs on unmount, so no detached
  // CodeMirror view leaks.
  $effect(() => {
    if (!host) {
      return;
    }
    const view = untrack(() =>
      createMergeDiffView({
        parent: host!,
        original,
        proposed,
        collapseUnchanged
      })
    );
    handle = view;
    return () => {
      view.destroy();
      handle = null;
    };
  });

  // Push prop changes into the live view without remounting (preserves scroll on
  // the common case where only collapseUnchanged toggles).
  $effect(() => {
    // Track all three so any change reconfigures.
    const next = { original, proposed, collapseUnchanged };
    if (handle) {
      handle.update(next);
    }
  });
</script>

<div bind:this={host} class={`cm-merge-host overflow-auto ${maxHeightClass}`}></div>
