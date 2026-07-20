import { invoke } from '@tauri-apps/api/core';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import {
  forEachImageEmbed,
  formatImageEmbedTarget,
  type ParsedImageEmbedTarget
} from '$lib/features/notepad/images/imageEmbedParser';

const MAX_IMAGE_ASSET_URL_CACHE_ENTRIES = 128;
const MAX_IMAGE_EMBED_ELEMENT_CACHE_ENTRIES = 256;

const imageAssetUrlCache = new Map<string, string>();
const pendingImageAssetUrlLoads = new Map<string, Promise<string>>();
const imageEmbedElementCache = new Map<string, CachedImageEmbedElement>();

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
  const scrollContainer = view.scrollDOM;
  const previousTop = scrollContainer.scrollTop;
  const previousLeft = scrollContainer.scrollLeft;

  runUpdate();

  scrollContainer.scrollTop = previousTop;
  scrollContainer.scrollLeft = previousLeft;

  queueMicrotask(() => {
    scrollContainer.scrollTop = previousTop;
    scrollContainer.scrollLeft = previousLeft;
  });
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

function dispatchSelection(view: EditorView, anchor: number) {
  view.dispatch(
    view.state.update({
      selection: { anchor },
      scrollIntoView: true
    })
  );
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
  // Eager: src is set asynchronously to a data: URL after IPC. Lazy loading
  // can skip decoding for zero-size widgets and leave the image blank forever.
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
        activeState.view.dispatch(
          activeState.view.state.update({
            changes: { from: activeState.from, to: activeState.to, insert: nextMarkdown }
          })
        );
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
    const selectionPos = Math.max(0, Math.min(currentState.from + 2, currentState.view.state.doc.length));
    dispatchSelection(currentState.view, selectionPos);
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

class ImageEmbedWidget extends WidgetType {
  constructor(
    private readonly widgetKey: string,
    private readonly view: EditorView,
    private readonly from: number,
    private readonly to: number,
    private readonly target: ParsedImageEmbedTarget
  ) {
    super();
  }

  override eq(other: ImageEmbedWidget) {
    return (
      this.widgetKey === other.widgetKey &&
      this.from === other.from &&
      this.to === other.to &&
      this.target.fileName === other.target.fileName &&
      this.target.width === other.target.width &&
      this.target.height === other.target.height
    );
  }

  override toDOM() {
    return createImageEmbedElement(this.widgetKey, this.view, this.from, this.to, this.target);
  }

  override ignoreEvent() {
    return false;
  }
}

export interface ImageEmbedRange {
  from: number;
  to: number;
}

export interface ImageEmbedDecorationBuild {
  decorations: DecorationSet;
  /** All embed spans in the doc (including those hidden because selection intersects). */
  ranges: ImageEmbedRange[];
}

export function selectionIntersectsImageEmbed(
  selection: { from: number; to: number },
  ranges: readonly ImageEmbedRange[]
) {
  return ranges.some((range) => selection.from < range.to && selection.to > range.from);
}

export function buildImageEmbedDecorations(view: EditorView): ImageEmbedDecorationBuild {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges: ImageEmbedRange[] = [];

  const selection = view.state.selection.main;
  const text = view.state.doc.toString();
  forEachImageEmbed(text, ({ from, to, target, widgetKey }) => {
    ranges.push({ from, to });
    // Hide the widget (show raw markdown) while the caret/selection touches
    // the embed so the source remains editable.
    if (selection.from < to && selection.to > from) {
      return;
    }

    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new ImageEmbedWidget(widgetKey, view, from, to, target)
      })
    );
  });

  return { decorations: builder.finish(), ranges };
}
