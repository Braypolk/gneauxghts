<script lang="ts">
  import { onMount } from 'svelte';
  import { Download, FileWarning, X } from '@lucide/svelte';
  import type { ChatAttachmentInput } from './types';
  import {
    attachmentBlob,
    attachmentDataUrl,
    attachmentPreviewKind,
    attachmentTextPreview,
    formatAttachmentBytes
  } from './attachments';

  interface Props {
    attachment: ChatAttachmentInput;
    onClose: () => void;
  }

  let { attachment, onClose }: Props = $props();
  let dialogElement = $state<HTMLDivElement | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let pdfUrl = $state<string | null>(null);
  let previewError = $state<string | null>(null);

  const kind = $derived(attachmentPreviewKind(attachment));
  const downloadUrl = $derived(
    kind === 'pdf' && pdfUrl ? pdfUrl : attachmentDataUrl(attachment)
  );
  const textPreview = $derived.by(() => {
    if (kind !== 'text') return null;
    try {
      return attachmentTextPreview(attachment);
    } catch {
      return null;
    }
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      }
    };
  }

  function onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }

  onMount(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (kind === 'pdf') {
      try {
        pdfUrl = URL.createObjectURL(attachmentBlob(attachment));
      } catch {
        previewError = 'This PDF could not be prepared for preview.';
      }
    }

    requestAnimationFrame(() => closeButton?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogElement) return;
      const focusable = Array.from(
        dialogElement.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], iframe'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      previousFocus?.focus();
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:portal
  class="attachment-preview-backdrop"
  role="presentation"
  onclick={onBackdropClick}
>
  <div
    bind:this={dialogElement}
    class="attachment-preview-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="attachment-preview-title"
  >
    <header class="attachment-preview-header">
      <div class="min-w-0 flex-1">
        <h2 id="attachment-preview-title" class="truncate text-sm font-semibold">
          {attachment.name}
        </h2>
        <p class="mt-0.5 text-[11px] text-muted-foreground">
          {attachment.mimeType} · {formatAttachmentBytes(attachment.sizeBytes)}
        </p>
      </div>
      <a
        class="attachment-preview-action"
        href={downloadUrl}
        download={attachment.name}
        aria-label={`Download ${attachment.name}`}
        title="Download"
      >
        <Download class="h-4 w-4" />
      </a>
      <button
        bind:this={closeButton}
        type="button"
        class="attachment-preview-action"
        aria-label="Close preview"
        title="Close preview"
        onclick={onClose}
      >
        <X class="h-4 w-4" />
      </button>
    </header>

    <div class="attachment-preview-content">
      {#if kind === 'image'}
        <img
          class="attachment-preview-image"
          src={attachmentDataUrl(attachment)}
          alt={attachment.name}
        />
      {:else if kind === 'pdf' && pdfUrl}
        <iframe
          class="attachment-preview-pdf"
          src={pdfUrl}
          title={`Preview of ${attachment.name}`}
        ></iframe>
      {:else if kind === 'text' && textPreview}
        <div class="attachment-preview-text-shell">
          {#if textPreview.truncated}
            <p class="attachment-preview-notice">
              Showing the first 512 KB of this file.
            </p>
          {/if}
          <pre class="attachment-preview-text">{textPreview.text}</pre>
        </div>
      {:else}
        <div class="attachment-preview-unavailable">
          <FileWarning class="h-8 w-8" />
          <p>{previewError ?? 'A preview is not available for this file type.'}</p>
          <a href={downloadUrl} download={attachment.name}>Download the file</a>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .attachment-preview-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: color-mix(in oklab, black 55%, transparent);
    backdrop-filter: blur(8px);
    isolation: isolate;
  }
  .attachment-preview-dialog {
    display: flex;
    width: min(64rem, 100%);
    height: min(48rem, calc(100vh - 2rem));
    min-height: 18rem;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 1.25rem;
    background: var(--background);
    color: var(--foreground);
    box-shadow: 0 24px 80px rgb(0 0 0 / 0.35);
  }
  .attachment-preview-header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.5rem;
    border-bottom: 1px solid var(--border);
    padding: 0.75rem 0.85rem 0.75rem 1rem;
  }
  .attachment-preview-action {
    display: inline-flex;
    height: 2rem;
    width: 2rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    color: var(--muted-foreground);
  }
  .attachment-preview-action:hover,
  .attachment-preview-action:focus-visible {
    background: var(--accent);
    color: var(--accent-foreground);
    outline: none;
  }
  .attachment-preview-content {
    display: flex;
    min-height: 0;
    flex: 1;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: color-mix(in oklab, var(--muted) 38%, var(--background));
  }
  .attachment-preview-image {
    max-height: 100%;
    max-width: 100%;
    object-fit: contain;
    padding: 1rem;
  }
  .attachment-preview-pdf {
    height: 100%;
    width: 100%;
    border: 0;
    background: white;
  }
  .attachment-preview-text-shell {
    height: 100%;
    width: 100%;
    overflow: auto;
  }
  .attachment-preview-notice {
    position: sticky;
    top: 0;
    border-bottom: 1px solid var(--border);
    background: var(--background);
    padding: 0.55rem 1rem;
    font-size: 0.72rem;
    color: var(--muted-foreground);
  }
  .attachment-preview-text {
    min-height: 100%;
    padding: 1rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.78rem;
    line-height: 1.55;
    tab-size: 2;
  }
  .attachment-preview-unavailable {
    display: flex;
    max-width: 22rem;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem;
    text-align: center;
    font-size: 0.85rem;
    color: var(--muted-foreground);
  }
  .attachment-preview-unavailable a {
    font-weight: 600;
    color: var(--foreground);
    text-decoration: underline;
    text-underline-offset: 0.2rem;
  }

  @media (max-width: 640px) {
    .attachment-preview-backdrop {
      padding: 0;
    }
    .attachment-preview-dialog {
      height: 100%;
      border: 0;
      border-radius: 0;
    }
  }
</style>
