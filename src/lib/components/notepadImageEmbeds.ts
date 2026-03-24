import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Selection,
  type Transaction
} from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { invoke } from '@tauri-apps/api/core';
import { notepadImagesConfig } from './notepadImagesShared';

const IMAGE_EMBED_PATTERN = /!\[\[([^\[\]\n]+?)\]\]/g;
const COMPLETE_IMAGE_EMBED_PATTERN = /!\[\[[^\[\]\n]+?\]\]/;
const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const IMAGE_SIZE_PATTERN = /^(?:(\d+)x(\d+)|(\d+)x|x(\d+)|(\d+))$/;
const MAX_IMAGE_ASSET_URL_CACHE_ENTRIES = 128;
const MAX_IMAGE_EMBED_ELEMENT_CACHE_ENTRIES = 256;

const imageAssetUrlCache = new Map<string, string>();
const pendingImageAssetUrlLoads = new Map<string, Promise<string>>();
const imageEmbedElementCache = new Map<string, CachedImageEmbedElement>();

interface ParsedImageEmbedTarget {
  fileName: string;
  width: number | null;
  height: number | null;
}

interface ImageEmbedMatch {
  from: number;
  to: number;
  target: ParsedImageEmbedTarget;
  widgetKey: string;
}

interface ImageEmbedWidgetState {
  view: EditorView;
  from: number;
  to: number;
  target: ParsedImageEmbedTarget;
}

interface CachedImageEmbedElement {
  container: HTMLSpanElement;
  image: HTMLImageElement;
  resizeHandle: HTMLSpanElement;
  state: ImageEmbedWidgetState;
}

interface ImageEmbedDecorationsState {
  decorations: DecorationSet;
  activeWidgetKey: string | null;
}

function setBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function getBoundedCacheEntry<K, V>(cache: Map<K, V>, key: K) {
  const value = cache.get(key);
  if (value === undefined) {
    return null;
  }

  cache.delete(key);
  cache.set(key, value);
  return value;
}

function isInCodeContext(selection: Selection) {
  const { $from } = selection;
  if ($from.parent.type.name === 'code_block') {
    return true;
  }

  return $from.marks().some((mark) => mark.type.name === 'code');
}

function selectionTouchesEmbed(selection: Selection, from: number, to: number) {
  if (selection.empty) {
    return selection.from > from && selection.from < to;
  }

  return selection.from < to && selection.to > from;
}

async function loadImageAssetUrl(fileName: string) {
  const cached = getBoundedCacheEntry(imageAssetUrlCache, fileName);
  if (cached) {
    return cached;
  }

  const pending = pendingImageAssetUrlLoads.get(fileName);
  if (pending) {
    return pending;
  }

  const nextLoad = invoke<string>('read_image_asset_data_url', { fileName })
    .then((dataUrl) => {
      setBoundedCacheEntry(
        imageAssetUrlCache,
        fileName,
        dataUrl,
        MAX_IMAGE_ASSET_URL_CACHE_ENTRIES
      );
      pendingImageAssetUrlLoads.delete(fileName);
      return dataUrl;
    })
    .catch((error) => {
      pendingImageAssetUrlLoads.delete(fileName);
      throw error;
    });

  pendingImageAssetUrlLoads.set(fileName, nextLoad);
  return nextLoad;
}

function preserveEditorScrollPosition(view: EditorView, runUpdate: () => void) {
  const scrollContainer = view.dom.closest<HTMLElement>('.notepad-editor-shell');
  const previousTop = scrollContainer?.scrollTop ?? 0;
  const previousLeft = scrollContainer?.scrollLeft ?? 0;

  runUpdate();

  if (!scrollContainer) {
    return;
  }

  scrollContainer.scrollTop = previousTop;
  scrollContainer.scrollLeft = previousLeft;

  queueMicrotask(() => {
    scrollContainer.scrollTop = previousTop;
    scrollContainer.scrollLeft = previousLeft;
  });
}

function clampTextWindow(doc: ProseMirrorNode, start: number, end: number, padding = 48) {
  const maxPos = Math.max(0, doc.content.size);
  return {
    from: Math.max(0, start - padding),
    to: Math.min(maxPos, end + padding)
  };
}

function textWindowContainsImageEmbed(doc: ProseMirrorNode, start: number, end: number) {
  const { from, to } = clampTextWindow(doc, start, end);
  return COMPLETE_IMAGE_EMBED_PATTERN.test(doc.textBetween(from, to, '\n', '\n'));
}

function transactionMayAffectImageEmbeds(
  transaction: Transaction,
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode
) {
  let affectsEmbeds = false;

  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (affectsEmbeds) {
        return;
      }

      if (
        textWindowContainsImageEmbed(oldDoc, oldStart, oldEnd) ||
        textWindowContainsImageEmbed(newDoc, newStart, newEnd)
      ) {
        affectsEmbeds = true;
      }
    });

    if (affectsEmbeds) {
      break;
    }
  }

  return affectsEmbeds;
}

function formatImageEmbedTarget(target: ParsedImageEmbedTarget) {
  if (target.width != null && target.height != null) {
    return `![[${target.fileName}|${target.width}x${target.height}]]`;
  }

  if (target.width != null) {
    return `![[${target.fileName}|${target.width}]]`;
  }

  if (target.height != null) {
    return `![[${target.fileName}|x${target.height}]]`;
  }

  return `![[${target.fileName}]]`;
}

function parseImageEmbedTarget(rawTarget: string): ParsedImageEmbedTarget | null {
  const [rawFileName, rawSize] = rawTarget.split('|', 2).map((segment) => segment.trim());
  if (!rawFileName || !IMAGE_FILE_PATTERN.test(rawFileName)) {
    return null;
  }

  if (!rawSize) {
    return {
      fileName: rawFileName,
      width: null,
      height: null
    };
  }

  const sizeMatch = rawSize.match(IMAGE_SIZE_PATTERN);
  if (!sizeMatch) {
    return {
      fileName: rawFileName,
      width: null,
      height: null
    };
  }

  const width = sizeMatch[1] ?? sizeMatch[3] ?? sizeMatch[5] ?? null;
  const height = sizeMatch[2] ?? sizeMatch[4] ?? null;

  return {
    fileName: rawFileName,
    width: width ? Number.parseInt(width, 10) : null,
    height: height ? Number.parseInt(height, 10) : null
  };
}

function forEachImageEmbed(doc: ProseMirrorNode, callback: (embed: ImageEmbedMatch) => void) {
  const occurrencesByRawTarget = new Map<string, number>();

  doc.descendants((node, position, parent) => {
    if (!node.isText || !node.text) {
      return;
    }

    if (
      parent?.type.name === 'code_block' ||
      node.marks.some((mark) => mark.type.name === 'code')
    ) {
      return;
    }

    for (const match of node.text.matchAll(IMAGE_EMBED_PATTERN)) {
      const index = match.index ?? -1;
      const rawTarget = match[1]?.trim();
      const target = rawTarget ? parseImageEmbedTarget(rawTarget) : null;

      if (index < 0 || !rawTarget || !target) {
        continue;
      }

      const occurrence = (occurrencesByRawTarget.get(rawTarget) ?? 0) + 1;
      occurrencesByRawTarget.set(rawTarget, occurrence);

      const from = position + index;
      const to = from + match[0].length;
      callback({
        from,
        to,
        target,
        widgetKey: `image-embed:${rawTarget}:${occurrence}`
      });
    }
  });
}

function findTouchedImageEmbedKey(doc: ProseMirrorNode, selection: Selection) {
  if (isInCodeContext(selection)) {
    return null;
  }

  let activeWidgetKey: string | null = null;
  forEachImageEmbed(doc, (embed) => {
    if (activeWidgetKey || !selectionTouchesEmbed(selection, embed.from, embed.to)) {
      return;
    }

    activeWidgetKey = embed.widgetKey;
  });

  return activeWidgetKey;
}

function updateImageEmbedElement(
  cachedElement: CachedImageEmbedElement,
  target: ParsedImageEmbedTarget
) {
  const { container, image } = cachedElement;
  cachedElement.state = {
    ...cachedElement.state,
    target
  };

  container.style.width = target.width ? `${target.width}px` : '';
  container.style.maxHeight = target.height ? `${target.height}px` : '';
  image.style.width = target.width ? `${target.width}px` : '';
  image.style.height = target.height ? `${target.height}px` : 'auto';
  image.alt = target.fileName;
  image.dataset.fileName = target.fileName;

  const cachedUrl = getBoundedCacheEntry(imageAssetUrlCache, target.fileName);
  if (cachedUrl) {
    container.dataset.loading = 'false';
    container.dataset.broken = 'false';
    if (image.src !== cachedUrl) {
      image.src = cachedUrl;
    }
    return;
  }

  if (container.dataset.loading === 'true' && image.dataset.fileName === target.fileName) {
    return;
  }

  container.dataset.loading = 'true';
  container.dataset.broken = 'false';
  void loadImageAssetUrl(target.fileName)
    .then((dataUrl) => {
      if (
        !container.isConnected &&
        imageEmbedElementCache.get(container.dataset.widgetKey ?? '')?.container !== container
      ) {
        return;
      }

      if (image.dataset.fileName !== target.fileName) {
        return;
      }

      container.dataset.loading = 'false';
      container.dataset.broken = 'false';
      if (image.src !== dataUrl) {
        image.src = dataUrl;
      }
    })
    .catch((error) => {
      if (image.dataset.fileName !== target.fileName) {
        return;
      }

      console.error('Failed to load image asset:', error);
      container.dataset.loading = 'false';
      container.dataset.broken = 'true';
      image.alt = `Missing image: ${target.fileName}`;
    });
}

function createImageEmbedElement(
  widgetKey: string,
  view: EditorView,
  from: number,
  to: number,
  target: ParsedImageEmbedTarget
) {
  const cachedElement = getBoundedCacheEntry(imageEmbedElementCache, widgetKey);
  if (cachedElement) {
    cachedElement.state = { view, from, to, target };
    updateImageEmbedElement(cachedElement, target);
    return cachedElement.container;
  }

  const container = document.createElement('span');
  container.className = 'gn-image-embed';
  container.contentEditable = 'false';
  container.dataset.widgetKey = widgetKey;

  const image = document.createElement('img');
  image.loading = 'lazy';
  image.decoding = 'async';

  image.addEventListener('load', () => {
    container.dataset.loading = 'false';
    container.dataset.broken = 'false';
  });

  image.addEventListener('error', () => {
    container.dataset.loading = 'false';
    container.dataset.broken = 'true';
    image.alt = `Missing image: ${image.dataset.fileName ?? 'image'}`;
  });

  const resizeHandle = document.createElement('span');
  resizeHandle.className = 'gn-image-embed-resize-handle';
  resizeHandle.title = 'Drag to resize image';
  resizeHandle.contentEditable = 'false';

  const nextCachedElement: CachedImageEmbedElement = {
    container,
    image,
    resizeHandle,
    state: {
      view,
      from,
      to,
      target
    }
  };

  resizeHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const currentState = nextCachedElement.state;
    const startX = event.clientX;
    const startWidth =
      Math.round(nextCachedElement.image.getBoundingClientRect().width) ||
      currentState.target.width ||
      320;
    const maxWidth = Math.max(96, currentState.view.dom.getBoundingClientRect().width - 32);
    let currentWidth = startWidth;

    const applyPreviewWidth = (width: number) => {
      currentWidth = Math.max(96, Math.min(width, maxWidth));
      nextCachedElement.container.style.width = `${currentWidth}px`;
      nextCachedElement.image.style.width = `${currentWidth}px`;
      nextCachedElement.image.style.height = 'auto';
    };

    const stopTracking = () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };

    const commitWidth = () => {
      stopTracking();
      const activeState = nextCachedElement.state;
      const nextWidth = Math.max(96, Math.round(currentWidth));
      const nextTarget: ParsedImageEmbedTarget = {
        fileName: activeState.target.fileName,
        width: nextWidth,
        height: null
      };
      const nextMarkdown = formatImageEmbedTarget(nextTarget);
      preserveEditorScrollPosition(activeState.view, () => {
        const transaction = activeState.view.state.tr.insertText(
          nextMarkdown,
          activeState.from,
          activeState.to
        );
        activeState.view.dispatch(transaction);
      });
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - startX;
      applyPreviewWidth(startWidth + deltaX);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      upEvent.preventDefault();
      commitWidth();
    };

    const handlePointerCancel = () => {
      stopTracking();
    };

    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
  });

  container.appendChild(image);
  container.appendChild(resizeHandle);
  container.addEventListener('pointerdown', (event) => {
    if (event.target === resizeHandle) {
      return;
    }

    event.preventDefault();
    const currentState = nextCachedElement.state;
    const maxPos = Math.max(1, currentState.view.state.doc.nodeSize - 2);
    const selectionPos = Math.max(1, Math.min(currentState.from + 2, maxPos));
    const transaction = currentState.view.state.tr.setSelection(
      TextSelection.create(currentState.view.state.doc, selectionPos)
    );
    currentState.view.dispatch(transaction);
    currentState.view.focus();
  });

  setBoundedCacheEntry(
    imageEmbedElementCache,
    widgetKey,
    nextCachedElement,
    MAX_IMAGE_EMBED_ELEMENT_CACHE_ENTRIES
  );
  updateImageEmbedElement(nextCachedElement, target);
  return container;
}

function buildImageEmbedDecorations(
  doc: ProseMirrorNode,
  selection: Selection,
  assetRootPath: string | null
) {
  if (!assetRootPath || isInCodeContext(selection)) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  forEachImageEmbed(doc, ({ from, to, target, widgetKey }) => {
    if (selectionTouchesEmbed(selection, from, to)) {
      return;
    }

    decorations.push(
      Decoration.inline(from, to, {
        class: 'gn-image-embed-source'
      })
    );
    decorations.push(
      Decoration.widget(
        from,
        (view) => createImageEmbedElement(widgetKey, view, from, to, target),
        {
          side: -1,
          key: widgetKey,
          ignoreSelection: true
        }
      )
    );
  });

  return DecorationSet.create(doc, decorations);
}

export const notepadImageEmbedsPlugin = $prose((ctx) => {
  const key = new PluginKey<ImageEmbedDecorationsState>('NOTEPAD_IMAGE_EMBEDS');

  return new Plugin({
    key,
    state: {
      init(_, state) {
        const assetRootPath = ctx.get(notepadImagesConfig.key).assetRootPath;
        return {
          decorations: buildImageEmbedDecorations(state.doc, state.selection, assetRootPath),
          activeWidgetKey: findTouchedImageEmbedKey(state.doc, state.selection)
        };
      },
      apply(transaction, pluginState, oldState, newState) {
        const assetRootPath = ctx.get(notepadImagesConfig.key).assetRootPath;
        if (!assetRootPath || isInCodeContext(newState.selection)) {
          return {
            decorations: DecorationSet.empty,
            activeWidgetKey: null
          };
        }

        const activeWidgetKey = findTouchedImageEmbedKey(newState.doc, newState.selection);
        if (
          transaction.docChanged &&
          activeWidgetKey === pluginState.activeWidgetKey &&
          !transactionMayAffectImageEmbeds(transaction, oldState.doc, newState.doc)
        ) {
          return {
            decorations: pluginState.decorations.map(transaction.mapping, transaction.doc),
            activeWidgetKey
          };
        }

        if (!transaction.docChanged && activeWidgetKey === pluginState.activeWidgetKey) {
          return {
            decorations: pluginState.decorations,
            activeWidgetKey
          };
        }

        return {
          decorations: buildImageEmbedDecorations(newState.doc, newState.selection, assetRootPath),
          activeWidgetKey
        };
      }
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations ?? DecorationSet.empty
    }
  });
});
