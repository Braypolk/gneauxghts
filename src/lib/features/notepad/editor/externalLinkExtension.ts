import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { EditorViewCallbacks } from './types';

export interface ExternalLinkActionsSession {
  anchor: HTMLElement;
  rawUrl: string;
  open: () => void;
  edit: () => void;
  focus: () => void;
  subscribe: (close: () => void) => () => void;
}

// Rendered links can live inside native editors, such as table cells. Their
// owner restores editing without moving CodeMirror's cursor into a widget.
const nativeLinkEditors = new WeakMap<HTMLElement, () => void>();
export function setRenderedLinkEditor(link: HTMLElement, edit: () => void) {
  nativeLinkEditors.set(link, edit);
}

export function findRenderedMarkdownLinkUrl(
  target: EventTarget | null
): string | null {
  if (!(target instanceof HTMLElement || target instanceof Text)) {
    return null;
  }

  const element = target instanceof Text ? target.parentElement : target;
  const linkElement =
    element?.closest<HTMLElement>('.cm-gn-link-styled') ?? null;
  const rawUrl = linkElement
    ?.querySelector<HTMLElement>('.cm-gn-link-tooltip')
    ?.textContent;
  const url = rawUrl?.trim();

  return url || null;
}

export function normalizeExternalLinkUrl(rawUrl: string): string | null {
  if (/^https?:\/\//i.test(rawUrl) || /^mailto:/i.test(rawUrl)) {
    return rawUrl;
  }

  if (/^www\./i.test(rawUrl)) {
    return `https://${rawUrl}`;
  }

  return null;
}

async function openExternalLink(rawUrl: string) {
  const url = normalizeExternalLinkUrl(rawUrl);
  if (!url) {
    return;
  }

  try {
    await openUrl(url);
  } catch (error) {
    console.error('Failed to open external link:', error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function createExternalLinkClickExtension(
  callbacks: (view: EditorView) => EditorViewCallbacks | null
) {
  return ViewPlugin.fromClass(
    class {
      readonly #view: EditorView;
      #invalidateActions: (() => void) | null = null;

      constructor(view: EditorView) {
        this.#view = view;
        this.#view.dom.addEventListener('click', this.#handleClick, {
          capture: true
        });
        this.#view.dom.addEventListener('mousedown', this.#handleMouseDown, true);
      }

      destroy() {
        this.#invalidateActions?.();
        this.#view.dom.removeEventListener('click', this.#handleClick, {
          capture: true
        });
        this.#view.dom.removeEventListener('mousedown', this.#handleMouseDown, true);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.reconfigured)) {
          this.#invalidateActions?.();
        }
      }

      #handleMouseDown = (event: MouseEvent) => {
        // A tap's compatibility mousedown must not move the native selection
        // into the widget before the Open/Edit choice. Touch scrolling is free
        // to proceed; actions are only shown by the eventual click.
        const url = findRenderedMarkdownLinkUrl(event.target);
        if (window.matchMedia('(any-pointer: coarse)').matches && url && normalizeExternalLinkUrl(url)) event.preventDefault();
      };

      #showActions(link: HTMLElement, rawUrl: string) {
        this.#invalidateActions?.();
        const from = Number(link.dataset.linkFrom);
        const to = Number(link.dataset.linkTo);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > this.#view.state.doc.length) return;

        // The editor owns validity and actions; the pane owner controls the
        // surface lifetime, including retained-pane collapse and mutual exclusion.
        let alive = true;
        let close: (() => void) | null = null;
        const invalidate = () => { alive = false; close?.(); };
        this.#invalidateActions = invalidate;
        callbacks(this.#view)?.onOpenExternalLinkActions?.({
          anchor: link,
          rawUrl,
          open: () => { if (alive) void openExternalLink(rawUrl); },
          edit: () => {
            if (!alive) return;
            const editNative = nativeLinkEditors.get(link);
            if (editNative) { editNative(); return; }
            this.#view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
            this.#view.focus();
          },
          focus: () => { if (alive) this.#view.focus(); },
          subscribe: (onClose) => {
            close = onClose;
            if (!alive) onClose();
            return () => {
              alive = false;
              close = null;
              if (this.#invalidateActions === invalidate) this.#invalidateActions = null;
            };
          }
        });
      }

      #handleClick = (event: MouseEvent) => {
        if (event.button !== 0) {
          return;
        }

        const modifier = event.metaKey !== event.ctrlKey && !event.altKey && !event.shiftKey;
        const touch = (event instanceof PointerEvent && (event.pointerType === 'touch' || event.pointerType === 'pen')) ||
          window.matchMedia('(any-pointer: coarse)').matches;
        const plainTouch = touch && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
        if (!modifier && !plainTouch) return;

        const rawUrl = findRenderedMarkdownLinkUrl(event.target);
        if (!rawUrl || !normalizeExternalLinkUrl(rawUrl)) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        if (modifier) void openExternalLink(rawUrl);
        else {
          const target = event.target instanceof HTMLElement ? event.target : (event.target as Text).parentElement;
          const link = target?.closest<HTMLElement>('.cm-gn-link-styled');
          if (link) this.#showActions(link, rawUrl);
        }
      };
    }
  );
}
