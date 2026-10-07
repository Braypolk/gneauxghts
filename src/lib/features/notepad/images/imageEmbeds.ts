import { EditorSelection, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import type { ImagesConfig } from './imageConfig';
import { createImageAssetLoader } from './imageAssetLoader';
import { ImageEmbedWidget, imageDecoration, availableImageWidth, type ImageWidgetActions } from './imageEmbedWidgets';
import { imageWidthChanges, type ImageEmbedMatch } from './imageEmbedParser';
import { imageSourceEffect, imageShowsSource, imageState, selectedImage } from './imageState';
import { restoreImageOrigin, type ImageViewerSession } from './imageViewerModel';
const sizeEntry = StateEffect.define<number | null>();
const openViewer = StateEffect.define<{ from: number; to: number; asset: string }>();
export function openImageViewerAt(view: EditorView, locator: { from: number; to: number; asset: string }) {
  if (!view.state.field(imageState, false)?.images.some(image => image.from === locator.from && image.to === locator.to && image.assetName === locator.asset)) return false;
  view.dispatch({ effects: openViewer.of(locator) });
  return true;
}
const sizeEntryField = StateField.define<number | null>({ create: () => null, update(value, tr) {
  let next = value == null ? null : tr.changes.mapPos(value, -1);
  for (const effect of tr.effects) if (effect.is(sizeEntry)) next = effect.value;
  if (!tr.newSelection.main.empty || tr.newSelection.main.head !== next || tr.docChanged) next = null;
  return next;
}});
export interface ImageCallbacks { onOpenImageViewer?: (session: ImageViewerSession) => void }
export function selectRenderedImage(view: EditorView, image: ImageEmbedMatch) {
  view.focus();
  view.dispatch({ selection: EditorSelection.range(image.from, image.to), effects: imageSourceEffect.of(null) });
}
export function editImageSource(view: EditorView, image: ImageEmbedMatch, size = false) {
  const hasSize = image.sizeFrom !== image.sizeTo;
  const localDestination = image.destinationFrom >= image.from && image.destinationTo <= image.to;
  const from = size ? (hasSize ? image.sizeFrom + 1 : image.labelTo) : localDestination ? image.destinationFrom : image.labelFrom;
  const to = size ? (hasSize ? image.sizeTo : from) : localDestination ? image.destinationTo : image.sizeFrom;
  view.dispatch({ selection: EditorSelection.range(from, to), effects: [imageSourceEffect.of(image.from), sizeEntry.of(size && !hasSize ? from : null)] });
  view.focus();
}
export function resizeRenderedImage(view: EditorView, image: ImageEmbedMatch, width: number | null, keyboard = false) {
  if (view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1) return;
  const current = view.state.field(imageState).images.find(ref => ref.from === image.from && ref.source === image.source);
  if (!current) return;
  const changes = view.state.changes(imageWidthChanges(current, width));
  if (changes.empty || changes.apply(view.state.doc).eq(view.state.doc)) return;
  const from = changes.mapPos(current.from, -1), to = changes.mapPos(current.to, 1);
  view.dispatch({ changes, selection: EditorSelection.range(from, to),
    annotations: keyboard ? [Transaction.userEvent.of('input.type.image.resize')] : [Transaction.userEvent.of('input.image.resize'), isolateHistory.of('full')] });
}
function removeImage(view: EditorView, image: ImageEmbedMatch, userEvent: string) {
  view.dispatch({ changes: { from: image.from, to: image.to }, selection: { anchor: image.from },
    annotations: [Transaction.userEvent.of(userEvent), isolateHistory.of('full')] });
}
function imageClipboard(event: ClipboardEvent, view: EditorView, cut: boolean) {
  const image = selectedImage(view.state);
  if (!image || view.composing || !event.clipboardData || (cut && view.state.readOnly)) return false;
  try { event.clipboardData.setData('text/plain', image.source); } catch { return false; }
  event.preventDefault();
  if (cut) removeImage(view, image, 'delete.cut');
  return true;
}
export function createImageEmbedsExtension(config: ImagesConfig, callbacks: (view: EditorView) => ImageCallbacks | null = () => null) {
  const fallbackLoader = config.loadImage ? null : createImageAssetLoader(name => invoke<string>('read_image_asset_data_url', { fileName: name }), () => config.assetRootPath);
  const listeners = new Set<() => void>();
  const viewListeners = new Set<(update: import('@codemirror/view').ViewUpdate | null) => void>();
  const invalidate = () => { for (const listener of [...listeners]) listener(); };
  const actions: ImageWidgetActions = {
    select: selectRenderedImage, source: editImageSource, resize: resizeRenderedImage,
    load: config.loadImage ?? fallbackLoader!.load,
    listen(cancel) { listeners.add(cancel); return () => listeners.delete(cancel); },
    open(view, image) {
      if (view.composing) return;
      selectRenderedImage(view, image);
      const model = view.state.field(imageState);
      let selection = view.state.selection, doc = view.state.doc, alive = true;
      const index = model.images.findIndex(ref => ref.from === image.from);
      const top = view.scrollDOM.scrollTop, left = view.scrollDOM.scrollLeft;
      if (index < 0) return;
      const isCurrent = () => alive && view.state.field(imageState, false)?.lifetime === model.lifetime && view.state.doc === doc;
      const signature = (images: readonly ImageEmbedMatch[]) => images.map(ref => `${ref.source}\0${ref.target.fileName}`).join('\0');
      const pinned = signature(model.images);
      callbacks(view)?.onOpenImageViewer?.({ images: model.images, index, load: actions.load,
        subscribe(close) {
          const watch = (update: import('@codemirror/view').ViewUpdate | null) => {
            if (!update || update.state.readOnly !== update.startState.readOnly || update.transactions.some(tr => tr.reconfigured || tr.isUserEvent('input.external-reset')) ||
              signature(update.state.field(imageState).images) !== pinned) { alive = false; close(); return; }
            for (const tr of update.transactions) selection = selection.map(tr.changes);
            doc = update.state.doc;
          };
          viewListeners.add(watch); return () => viewListeners.delete(watch);
        }, restore: () => restoreImageOrigin(view, model.lifetime, isCurrent, selection, top, left) });
    }
  };
  const decorations = StateField.define({
    create(state) { return build(state); },
    update(value, tr) { return tr.docChanged || tr.selection || tr.effects.length || tr.reconfigured ? build(tr.state) : value; },
    provide(field) { return EditorView.decorations.from(field); }
  });
  function build(state: import('@codemirror/state').EditorState) {
    const selected = selectedImage(state);
    const ranges = [];
    const model = state.field(imageState);
    const images = model.sourcePreview && !model.images.some(image => image.from === model.sourcePreview!.from)
      ? [...model.images, model.sourcePreview] : model.images;
    for (const image of images) {
      const line = state.doc.lineAt(image.from);
      const block = image.to <= line.to && !state.sliceDoc(line.from, image.from).trim() && !state.sliceDoc(image.to, line.to).trim();
      if (imageShowsSource(state, image)) {
        ranges.push(Decoration.widget({ widget: new ImageEmbedWidget(image, false, block, actions, state.readOnly), block, side: 1 }).range(image.to));
      } else ranges.push(imageDecoration(image, selected?.from === image.from, block, actions, state.readOnly).range(image.from, image.to));
    }
    return Decoration.set(ranges, true);
  }
  const lifecycle = ViewPlugin.fromClass(class {
    update(update: import('@codemirror/view').ViewUpdate) {
      for (const transaction of update.transactions) for (const effect of transaction.effects) {
        if (!effect.is(openViewer)) continue;
        const doc = update.state.doc, lifetime = update.state.field(imageState).lifetime;
        const locator = effect.value;
        queueMicrotask(() => {
          if (update.view.state.doc !== doc || update.view.state.field(imageState, false)?.lifetime !== lifetime) return;
          const image = update.view.state.field(imageState).images.find(image => image.from === locator.from && image.to === locator.to && image.assetName === locator.asset);
          if (image) actions.open(update.view, image);
        });
      }
      if (update.docChanged || update.state.readOnly !== update.startState.readOnly || update.transactions.some(tr => tr.reconfigured)) invalidate();
      if (update.docChanged || update.transactions.some(tr => tr.reconfigured)) for (const listener of [...viewListeners]) listener(update);
    }
    destroy() { invalidate(); for (const listener of [...viewListeners]) listener(null); viewListeners.clear(); listeners.clear(); fallbackLoader?.destroy(); }
  });
  return [imageState, sizeEntryField, decorations, lifecycle,
    EditorView.atomicRanges.of(view => view.state.field(decorations)),
    Prec.highest(EditorView.domEventHandlers({
      copy(event, view) { return imageClipboard(event, view, false); },
      cut(event, view) { return imageClipboard(event, view, true); },
      beforeinput(event, view) {
        const pos = view.state.field(sizeEntryField);
        if (pos == null || view.state.readOnly || view.composing || !event.data || !/^\d+$/.test(event.data)) return false;
        const image = view.state.field(imageState).images.find(ref => ref.labelTo === pos);
        if (!image) return false;
        event.preventDefault(); view.dispatch({ changes: imageWidthChanges(image, Number(event.data)), selection: { anchor: pos + event.data.length + 1 },
          effects: sizeEntry.of(null), annotations: Transaction.userEvent.of('input.type') }); return true;
      },
      keydown(event, view) {
        if (view.composing || event.isComposing || view.state.selection.ranges.length !== 1 || event.altKey) return false;
        const selected = selectedImage(view.state), range = view.state.selection.main;
        const modified = event.metaKey || event.ctrlKey;
        if (modified) {
          if (!selected || event.shiftKey || !['c', 'x'].includes(event.key.toLowerCase())) return false;
          const cut = event.key.toLowerCase() === 'x';
          if (cut && view.state.readOnly) return false;
          const doc = view.state.doc, lifetime = view.state.field(imageState).lifetime;
          void navigator.clipboard.writeText(selected.source).then(() => {
            if (cut && !view.state.readOnly && view.state.doc === doc && view.state.field(imageState, false)?.lifetime === lifetime) {
              removeImage(view, selected, 'delete.cut');
            }
          }).catch(error => console.error('Cannot copy image source:', error));
          return true;
        }
        if (event.shiftKey && event.key !== '+') return false;
        if (selected) {
          if (event.key === ' ' ) { actions.open(view, selected); return true; }
          if (event.key === 'Enter' || event.key === 'Tab') { editImageSource(view, selected, event.key === 'Tab'); return true; }
          if (['-', '=', '+', '0', 'Backspace', 'Delete'].includes(event.key)) {
            if (view.state.readOnly) return false;
            if (event.key === 'Backspace' || event.key === 'Delete') removeImage(view, selected, 'delete.image');
            else {
              const widget = [...view.dom.querySelectorAll<HTMLElement>('.gn-image-embed')].find(el => el.dataset.selected === 'true');
              const width = selected.target.width ?? widget?.getBoundingClientRect().width ?? 320;
              resizeRenderedImage(view, selected, event.key === '0' ? null : Math.max(48, Math.min(widget ? availableImageWidth(view, widget) : Math.max(48, view.contentDOM.clientWidth - 24), width + (event.key === '-' ? -50 : 50))), event.key !== '0');
            }
            return true;
          }
          if (event.key.startsWith('Arrow')) {
            const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
            const pos = backwards ? selected.from : selected.to;
            view.dispatch({ selection: { anchor: pos }, effects: imageSourceEffect.of(null), scrollIntoView: true }); return true;
          }
          if (event.key === 'Escape') { view.dispatch({ selection: { anchor: selected.to } }); return true; }
        } else if (range.empty && event.key.startsWith('Arrow')) {
          const images = view.state.field(imageState).images.filter(image => !imageShowsSource(view.state, image));
          const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
          const image = backwards ? images.findLast(ref => ref.to <= range.head) : images.find(ref => ref.from >= range.head);
          if (image) {
            const between = backwards ? view.state.sliceDoc(image.to, range.head) : view.state.sliceDoc(range.head, image.from);
            if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? between.length === 0 : /^\s*$/.test(between) && between.split('\n').length <= 3)) {
              selectRenderedImage(view, image); return true;
            }
          }
        }
        return false;
      }
    }))];
}
