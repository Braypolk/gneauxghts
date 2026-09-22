<script lang="ts">
  import { mount, unmount } from 'svelte';
  import type { EditorView } from '@codemirror/view';
  import NoteTags from './NoteTags.svelte';

  let { view, tags, error, disabled, onChange, onDone }: {
    view: EditorView | undefined;
    tags: string[];
    error?: string;
    disabled: boolean;
    onChange: (tags: string[]) => void;
    onDone: () => void;
  } = $props();

  // Keep metadata outside the editable document, but inside its scroll owner.
  // Runtime swaps reuse this view; pane teardown or hiding tags removes the host.
  $effect(() => {
    const editor = view;
    if (!editor) return;
    const host = document.createElement('div');
    host.className = 'note-tags-scroll-header';
    host.style.cssText = 'position:absolute;top:var(--editor-top-padding);left:0;width:100%;z-index:1;';
    editor.scrollDOM.prepend(host);
    const instance = mount(NoteTags, {
      target: host,
      props: {
        get tags() { return tags; },
        get error() { return error; },
        get disabled() { return disabled; },
        onChange: (next: string[]) => onChange(next),
        onDone: () => onDone()
      }
    });
    let lastHeight: number | undefined;
    const observer = new ResizeObserver(() => {
      const height = host.offsetHeight;
      if (height === lastHeight) return;
      lastHeight = height;
      editor.dom.style.setProperty('--editor-tags-height', `${height}px`);
      editor.requestMeasure();
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      void unmount(instance);
      host.remove();
      editor.dom.style.removeProperty('--editor-tags-height');
      editor.requestMeasure();
    };
  });
</script>
