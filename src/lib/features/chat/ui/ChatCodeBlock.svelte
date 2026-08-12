<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, Copy } from '@lucide/svelte';
  import { LanguageDescription } from '@codemirror/language';
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { createCodeHighlight } from '$lib/features/notepad/markdown/markdownHighlight';
  import { languages } from '$lib/vendor/codemirrorLanguageData';

  interface Props {
    code: string;
    language?: string;
  }

  let { code, language = '' }: Props = $props();
  let host = $state<HTMLDivElement | null>(null);
  let copied = $state(false);
  let view: EditorView | null = null;
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  let languageRequest = 0;
  const languageCompartment = new Compartment();

  const languageLabel = $derived(language || 'Plain text');

  const codeTheme = EditorView.theme({
    '&.cm-editor.cm-chat-code': {
      backgroundColor: 'transparent',
      color: 'var(--foreground)',
      fontSize: '0.82rem'
    },
    '&.cm-editor.cm-chat-code.cm-focused': { outline: 'none' },
    '&.cm-editor.cm-chat-code .cm-scroller': {
      width: '100%',
      minWidth: '0',
      maxWidth: '100%',
      overflowX: 'auto',
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.55'
    },
    '&.cm-editor.cm-chat-code .cm-content': {
      width: 'max-content',
      minWidth: '100%',
      padding: '0.75rem 0.85rem',
      caretColor: 'transparent'
    },
    '&.cm-editor.cm-chat-code .cm-line': { padding: '0' },
    '&.cm-editor.cm-chat-code .cm-selectionBackground': {
      backgroundColor: 'var(--selection-background) !important'
    }
  });

  function matchingLanguage(name: string) {
    return name
      ? LanguageDescription.matchLanguageName(languages, name, true)
      : null;
  }

  async function updateLanguage(nextLanguage: string) {
    const currentView = view;
    if (!currentView) return;
    const request = ++languageRequest;
    const description = matchingLanguage(nextLanguage);

    if (!description) {
      currentView.dispatch({
        effects: languageCompartment.reconfigure([])
      });
      return;
    }

    try {
      const support = await description.load();
      if (request !== languageRequest || view !== currentView) return;
      currentView.dispatch({
        effects: languageCompartment.reconfigure(support)
      });
    } catch {
      if (request !== languageRequest || view !== currentView) return;
      currentView.dispatch({
        effects: languageCompartment.reconfigure([])
      });
    }
  }

  function updateDocument(nextCode: string) {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === nextCode) return;
    view.dispatch({
      changes: nextCode.startsWith(current)
        ? { from: current.length, insert: nextCode.slice(current.length) }
        : { from: 0, to: current.length, insert: nextCode }
    });
  }

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    copied = true;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copied = false;
      copyResetTimer = null;
    }, 1500);
  }

  onMount(() => {
    if (!host) return;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: code,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            'aria-label': `${languageLabel} code block`,
            tabindex: '0'
          }),
          languageCompartment.of([]),
          createCodeHighlight(),
          codeTheme
        ]
      })
    });
    void updateLanguage(language);

    return () => {
      languageRequest += 1;
      if (copyResetTimer) clearTimeout(copyResetTimer);
      view?.destroy();
      view = null;
    };
  });

  $effect(() => {
    updateDocument(code);
  });

  $effect(() => {
    void updateLanguage(language);
  });
</script>

<div
  class="chat-code-block"
  data-markdown-code-language={language}
>
  <div class="chat-code-block__header">
    <span>{languageLabel}</span>
    <button
      type="button"
      class="chat-code-block__copy"
      aria-label="Copy code"
      onclick={() => void copyCode()}
    >
      {#if copied}
        <Check class="h-3.5 w-3.5" /> Copied
      {:else}
        <Copy class="h-3.5 w-3.5" /> Copy
      {/if}
    </button>
  </div>
  <div bind:this={host} class="chat-code-block__editor"></div>
  <noscript><pre><code>{code}</code></pre></noscript>
</div>
