<script lang="ts">
  import Notepad from '$lib/features/notepad/Notepad.svelte';
  import { workspaceStore } from '$lib/features/notepad/workspace/workspaceStore.svelte';

  // When the workspace is split into two panes, let the editor area grow up to
  // double its normal max width so each pane can occupy roughly a full normal
  // editor width. On narrower screens it still uses the full available width
  // (layout already provides side padding via `sm:px-4`).
  let isSplit = $derived(workspaceStore.paneOrder.length === 2);
</script>

<div class="h-full w-full bg-background text-foreground flex flex-col overflow-hidden">
  <main
    class="notepad-area-shell relative mx-auto flex w-full flex-1 flex-col justify-center overflow-hidden pb-0 transition-all duration-300 ease-in-out min-[950px]:flex-row sm:pb-4"
    class:notepad-area-shell--split={isSplit}
  >
    <div
      class="notepad-area relative flex h-full min-h-0 w-full flex-1 justify-center transition-all duration-500"
      class:notepad-area--split={isSplit}
    >
      <Notepad />
    </div>
  </main>
</div>

<style>
  /* Normal (single-pane) max widths — unchanged from the original Tailwind
     `max-w-400` on the outer shell and `max-w-5xl` on the editor area. */
  .notepad-area-shell {
    max-width: 100rem;
  }

  .notepad-area {
    max-width: 64rem;
  }

  /* While split, the editor area may grow up to double its normal max width
     (2 * 64rem = 128rem) so each pane is ~one full normal editor width. Below
     that cap it fills the parent like single-pane — no extra inset, since the
     app shell already pads with `sm:px-4`. */
  .notepad-area-shell--split {
    max-width: 128rem;
  }

  .notepad-area--split {
    max-width: 128rem;
  }
</style>
