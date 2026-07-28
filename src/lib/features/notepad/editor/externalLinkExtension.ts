import { EditorView, ViewPlugin } from '@codemirror/view';
import { openUrl } from '@tauri-apps/plugin-opener';

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

export function createExternalLinkClickExtension() {
  return ViewPlugin.fromClass(
    class {
      readonly #view: EditorView;

      constructor(view: EditorView) {
        this.#view = view;
        this.#view.dom.addEventListener('click', this.#handleClick, {
          capture: true
        });
      }

      destroy() {
        this.#view.dom.removeEventListener('click', this.#handleClick, {
          capture: true
        });
      }

      #handleClick = (event: MouseEvent) => {
        if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) {
          return;
        }

        const rawUrl = findRenderedMarkdownLinkUrl(event.target);
        if (!rawUrl || !normalizeExternalLinkUrl(rawUrl)) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        void openExternalLink(rawUrl);
      };
    }
  );
}
