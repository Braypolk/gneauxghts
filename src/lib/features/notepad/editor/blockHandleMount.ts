import { flushSync, mount, unmount } from 'svelte';
import BlockHandle from '$lib/features/notepad/editor/BlockHandle.svelte';

export interface BlockHandleRefs {
  content: HTMLDivElement;
  addButton: HTMLButtonElement;
  dragButton: HTMLButtonElement;
}

/**
 * Mounts the block handle UI (Svelte) into the editor root and returns teardown.
 * Uses flushSync so refs are ready before returning.
 */
export function mountBlockHandle(
  editorRoot: HTMLDivElement,
  onReady: (refs: BlockHandleRefs) => void
): () => void {
  const wrapper = document.createElement('div');
  editorRoot.appendChild(wrapper);

  const instance = mount(BlockHandle, {
    target: wrapper,
    props: { onReady }
  });

  flushSync();

  return () => {
    void unmount(instance);
    wrapper.remove();
  };
}
