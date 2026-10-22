import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import type { ImageEmbedMatch } from './imageEmbedParser';
import { selectedImage } from './imageState';
import type { ImageDimensionCache, ImageDimensions } from './imageDimensions';
export interface ImageEmbedRange { from: number; to: number }
export function selectionIntersectsImageEmbed(selection: { from: number; to: number }, ranges: readonly ImageEmbedRange[]) {
  return ranges.some(range => selection.from < range.to && selection.to > range.from);
}
export function availableImageWidth(view: EditorView, element: HTMLElement) {
  const line = element.closest<HTMLElement>('.cm-line');
  const style = getComputedStyle(line ?? element);
  const inset = line ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    : parseFloat(style.marginLeft) + parseFloat(style.marginRight);
  return Math.max(48, (line?.clientWidth ?? view.contentDOM.clientWidth) - (inset || 0));
}
export interface ImageWidgetActions {
  select(view: EditorView, image: ImageEmbedMatch): void;
  source(view: EditorView, image: ImageEmbedMatch, size?: boolean): void;
  resize(view: EditorView, image: ImageEmbedMatch, width: number): void;
  resizeStep(view: EditorView, image: ImageEmbedMatch, direction: -1 | 1): void;
  open(view: EditorView, image: ImageEmbedMatch): void;
  load(name: string, refresh?: boolean): Promise<string>;
  dimensions: ImageDimensionCache;
  listen(cancel: () => void): () => void;
}
interface MountedImage {
  ref: ImageEmbedMatch; alive: boolean; generation: number; cancel: (() => void) | null;
  image: HTMLImageElement; status: HTMLElement; load(refresh?: boolean): void;
  suppressClick: boolean;
  selectedOnPointerDown: boolean | null;
  dimensions?: ImageDimensions;
}
const mounted = new WeakMap<HTMLElement, MountedImage>();
function applyImageLayout(dom: HTMLElement, data: MountedImage) {
  const { width, height } = data.ref.target;
  const intrinsic = data.dimensions;
  const ratio = intrinsic ? intrinsic.width / intrinsic.height : 16 / 9;
  const renderedWidth = width ?? (height ? height * ratio : intrinsic?.width ?? 320);
  const renderedHeight = height ?? renderedWidth / ratio;
  dom.style.width = `${renderedWidth}px`;
  dom.style.aspectRatio = `${renderedWidth} / ${renderedHeight}`;
}
export class ImageEmbedWidget extends WidgetType {
  constructor(readonly ref: ImageEmbedMatch, readonly selected: boolean,
    readonly block: boolean, readonly actions: ImageWidgetActions, readonly readOnly = false) { super(); }
  override eq(other: ImageEmbedWidget) {
    return this.ref.source === other.ref.source && this.ref.from === other.ref.from &&
      this.ref.to === other.ref.to && this.ref.target.fileName === other.ref.target.fileName &&
      this.ref.target.width === other.ref.target.width && this.ref.target.height === other.ref.target.height &&
      this.selected === other.selected && this.block === other.block && this.readOnly === other.readOnly;
  }
  override toDOM(view: EditorView) {
    const container = document.createElement(this.block ? 'div' : 'span');
    container.className = 'gn-image-embed'; container.contentEditable = 'false';
    const image = document.createElement('img'); image.draggable = false;
    const status = document.createElement('span'); status.className = 'gn-image-status';
    status.setAttribute('role', 'status');
    const data: MountedImage = { ref: this.ref, alive: true, generation: 0, cancel: null, image, status, suppressClick: false, selectedOnPointerDown: null,
      load: (refresh = false) => {
        const generation = ++data.generation;
        status.replaceChildren(); status.textContent = 'Loading image…'; container.dataset.loading = 'true';
        container.dataset.broken = 'false'; container.setAttribute('aria-busy', 'true');
        const name = data.ref.assetName;
        const fail = () => {
          if (!data.alive || generation !== data.generation) return;
          container.dataset.loading = 'false'; container.dataset.broken = 'true';
          container.setAttribute('aria-busy', 'false');
          status.textContent = data.ref.error ?? 'Image unavailable. ';
          if (name) {
            const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
            retry.onclick = event => { event.stopPropagation(); data.load(true); }; status.append(retry);
          }
          view.requestMeasure();
        };
        if (!name) { fail(); return; }
        image.onerror = fail;
        void this.actions.load(name, refresh).then(url => {
          if (!data.alive || generation !== data.generation) return;
          data.dimensions = this.actions.dimensions.get(name, url);
          if (!data.cancel) applyImageLayout(container, data);
          image.onload = () => {
            if (!data.alive || generation !== data.generation) return;
            data.dimensions = { width: image.naturalWidth, height: image.naturalHeight };
            this.actions.dimensions.set(name, url, data.dimensions);
            if (!data.cancel) applyImageLayout(container, data);
            status.replaceChildren(); container.dataset.loading = 'false'; container.dataset.broken = 'false';
            container.setAttribute('aria-busy', 'false'); view.requestMeasure();
          };
          image.src = url;
          view.requestMeasure();
        }, fail);
      }
    };
    mounted.set(container, data);
    const toolbar = document.createElement('span'); toolbar.className = 'gn-image-toolbar';
    const button = (label: string, text: string, action: () => void) => {
      const result = document.createElement('button'); result.type = 'button'; result.title = label;
      result.setAttribute('aria-label', label); result.textContent = text;
      result.onpointerdown = event => event.stopPropagation();
      result.onclick = event => { event.preventDefault(); event.stopPropagation(); action(); };
      return result;
    };
    toolbar.append(button('Zoom image', 'Zoom', () => this.actions.open(view, data.ref)),
      button('Edit image source', '</>', () => this.actions.source(view, data.ref)));
    for (const [label, text, direction] of [
      ['Decrease image size', '−', -1], ['Increase image size', '+', 1]
    ] as const) {
      const control = button(label, text, () => {
        this.actions.resizeStep(view, data.ref, direction);
        view.focus();
      });
      control.className = 'gn-image-size-step';
      toolbar.append(control);
    }
    container.append(image, status, toolbar);
    const isSelected = () => {
      const selected = selectedImage(view.state);
      return selected?.from === data.ref.from && selected.to === data.ref.to;
    };
    container.onpointerdown = event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
      data.suppressClick = false;
      // Selection changes immediately; decide activation from the state before it.
      data.selectedOnPointerDown = isSelected();
      event.preventDefault(); event.stopPropagation(); this.actions.select(view, data.ref);
    };
    container.onclick = event => {
      const open = data.selectedOnPointerDown ?? isSelected();
      data.selectedOnPointerDown = null;
      if (data.suppressClick) { data.suppressClick = false; event.preventDefault(); event.stopPropagation(); return; }
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault(); event.stopPropagation();
      if (open && isSelected()) this.actions.open(view, data.ref);
      else this.actions.select(view, data.ref);
    };
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const handle = button(`Resize image ${corner}`, '', () => {});
      handle.className = `gn-image-resize-handle gn-image-resize-${corner}`;
      handle.tabIndex = -1;
      handle.onpointerdown = event => {
        event.preventDefault(); event.stopPropagation();
        if (event.button !== 0 || container.dataset.loading === 'true' || container.dataset.broken === 'true' || view.state.readOnly || view.state.selection.ranges.length !== 1) return;
        data.suppressClick = true;
        this.actions.select(view, data.ref);
        data.cancel?.();
        const start = image.getBoundingClientRect();
        const startX = event.clientX, startY = event.clientY;
        const signX = corner.endsWith('w') ? -1 : 1, signY = corner.startsWith('n') ? -1 : 1;
        const ratio = start.height / Math.max(1, start.width);
        const maximum = availableImageWidth(view, container);
        let width = start.width;
        let moved = false;
        const gesture = new AbortController();
        const stopListening = this.actions.listen(() => cancel(false));
        const reset = () => { gesture.abort(); stopListening(); data.cancel = null;
          if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
          applyImageLayout(container, data); view.requestMeasure(); };
        const cancel = (restoreFocus = true) => { reset(); if (restoreFocus && data.alive) view.focus(); };
        data.cancel = () => cancel(false);
        container.style.aspectRatio = `${start.width} / ${start.height}`;
        if (event.isTrusted) handle.setPointerCapture(event.pointerId);
        handle.addEventListener('lostpointercapture', () => cancel(), { signal: gesture.signal });
        window.addEventListener('pointermove', move => {
          if (move.pointerId !== event.pointerId) return;
          const dx = (move.clientX - startX) * signX, dy = (move.clientY - startY) * signY;
          width = Math.min(maximum, Math.max(48, Math.round(start.width + (dx + dy * ratio) / (1 + ratio * ratio))));
          moved ||= Math.abs(width - start.width) >= 2;
          container.style.width = `${width}px`; view.requestMeasure();
        }, { signal: gesture.signal });
        window.addEventListener('pointerup', up => {
          if (up.pointerId !== event.pointerId) return;
          reset(); if (moved && data.alive) this.actions.resize(view, data.ref, width);
          if (data.alive) view.focus();
        }, { signal: gesture.signal });
        window.addEventListener('pointercancel', () => cancel(), { signal: gesture.signal });
        window.addEventListener('blur', () => cancel(false), { signal: gesture.signal });
        window.addEventListener('keydown', key => { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); cancel(); } }, { capture: true, signal: gesture.signal });
      };
      container.append(handle);
    }
    data.dimensions = this.ref.assetName ? this.actions.dimensions.get(this.ref.assetName) : undefined;
    this.updateDOM(container, view); data.load(); return container;
  }
  override updateDOM(dom: HTMLElement, view: EditorView) {
    const data = mounted.get(dom);
    if (!data || data.ref.target.fileName !== this.ref.target.fileName || (dom.tagName === 'DIV') !== this.block) return false;
    data.ref = this.ref;
    dom.dataset.selected = String(this.selected); dom.dataset.fileName = this.ref.target.fileName;
    dom.dataset.readonly = String(this.readOnly);
    for (const control of dom.querySelectorAll<HTMLButtonElement>('.gn-image-size-step')) control.disabled = this.readOnly;
    if (!data.cancel) {
      applyImageLayout(dom, data);
    }
    data.image.alt = this.ref.syntax === 'markdown' ? view.state.sliceDoc(this.ref.labelFrom, this.ref.sizeFrom) : this.ref.target.fileName;
    return true;
  }
  override ignoreEvent() { return true; }
  override destroy(dom: HTMLElement) {
    const data = mounted.get(dom); if (!data) return;
    data.cancel?.(); data.alive = false; data.generation++;
    data.image.onload = data.image.onerror = null; mounted.delete(dom);
  }
}
export function imageDecoration(image: ImageEmbedMatch, selected: boolean, block: boolean, actions: ImageWidgetActions, readOnly: boolean) {
  return Decoration.replace({ widget: new ImageEmbedWidget(image, selected, block, actions, readOnly), block });
}
export type { DecorationSet };
