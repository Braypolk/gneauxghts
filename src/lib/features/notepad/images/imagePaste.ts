import { StateEffect, StateField, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { StoredImageAsset } from '../model/types';
import type { ImagesConfig } from './imageConfig';
interface Upload {
  id: symbol; from: number; to: number; original: string; files: File[];
  assets: (StoredImageAsset | null)[]; error: boolean; pending: boolean;
}
const setUpload = StateEffect.define<Upload>();
const removeUpload = StateEffect.define<symbol>();
const uploads = StateField.define<readonly Upload[]>({
  create: () => [],
  update(value, tr) {
    const next = value.filter(job => {
      let touched = tr.isUserEvent('input.external-reset');
      tr.changes.iterChangedRanges((from, to) => {
        if (from <= job.to && to >= job.from) touched = true;
      });
      return !touched;
    }).map(job => ({ ...job, from: tr.changes.mapPos(job.from, 1), to: tr.changes.mapPos(job.to, -1) }));
    for (const effect of tr.effects) {
      if (effect.is(removeUpload)) { const index = next.findIndex(job => job.id === effect.value); if (index >= 0) next.splice(index, 1); }
      if (effect.is(setUpload)) { const index = next.findIndex(job => job.id === effect.value.id); if (index >= 0) next[index] = effect.value; else next.push(effect.value); }
    }
    return next.sort((a, b) => a.from - b.from);
  }
});
class UploadWidget extends WidgetType {
  constructor(readonly job: Upload, readonly retry: () => void, readonly cancel: () => void) { super(); }
  override eq(other: UploadWidget) { return this.job.id === other.job.id && this.job.error === other.job.error && this.job.pending === other.job.pending; }
  override toDOM() {
    const element = document.createElement('span'); element.className = 'gn-image-upload-placeholder'; element.contentEditable = 'false';
    element.setAttribute('role', 'status'); element.textContent = this.job.error ? 'Image save failed. ' : 'Saving image… ';
    for (const [label, run] of [...(this.job.error ? [['Retry', this.retry] as const] : []), ['Cancel', this.cancel] as const]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.onclick = event => { event.preventDefault(); event.stopPropagation(); run(); }; element.append(button);
    }
    return element;
  }
  override ignoreEvent() { return true; }
}
export function createImagePasteExtension(config: ImagesConfig) {
  const lifecycle = ViewPlugin.fromClass(class { alive = true; destroy() { this.alive = false; } });
  function find(view: EditorView, id: symbol) { return view.state.field(uploads, false)?.find(job => job.id === id); }
  async function run(view: EditorView, id: symbol) {
    const owner = view.plugin(lifecycle), job = find(view, id);
    if (!owner || !job || job.pending || view.state.readOnly) return;
    view.dispatch({ effects: setUpload.of({ ...job, pending: true, error: false }) });
    const results = await Promise.allSettled(job.files.map((file, index) => job.assets[index] ? Promise.resolve(job.assets[index]!) : config.storePastedImage(file)));
    const current = find(view, id);
    if (!owner.alive || view.plugin(lifecycle) !== owner || !current || view.state.readOnly) return;
    const assets = results.map(result => result.status === 'fulfilled' ? result.value : null);
    if (assets.some(asset => !asset)) {
      view.dispatch({ effects: setUpload.of({ ...current, assets, pending: false, error: true }) }); return;
    }
    if (view.state.sliceDoc(current.from, current.to) !== current.original) {
      view.dispatch({ effects: removeUpload.of(id) }); return;
    }
    const markdown = assets.map(asset => `![[${asset!.fileName}]]`).join('\n\n');
    view.dispatch({ changes: { from: current.from, to: current.to, insert: markdown },
      selection: { anchor: current.from + markdown.length }, effects: removeUpload.of(id), scrollIntoView: true,
      annotations: [Transaction.userEvent.of('input.image.paste'), isolateHistory.of('full')] });
  }
  const placeholders = StateField.define({
    create: () => Decoration.none,
    update(_value, tr) {
      return Decoration.set(tr.state.field(uploads).map(job => Decoration.widget({
        side: -1, widget: new UploadWidget(job,
          () => { const view = views.get(job.id); if (view) void run(view, job.id); },
          () => { const view = views.get(job.id); if (view && find(view, job.id)) view.dispatch({ effects: removeUpload.of(job.id) }); })
      }).range(job.from)), true);
    },
    provide: field => EditorView.decorations.from(field)
  });
  // View bindings are scoped to this extension and removed with each job/lifetime.
  const views = new Map<symbol, EditorView>();
  const cleanup = ViewPlugin.fromClass(class {
    update(update: import('@codemirror/view').ViewUpdate) {
      const current = update.state.field(uploads);
      for (const id of views.keys()) if (!current.some(job => job.id === id)) views.delete(id);
      if (update.state.readOnly && current.length) queueMicrotask(() => {
        if (update.view.plugin(lifecycle)?.alive && update.view.state.readOnly)
          update.view.dispatch({ effects: update.view.state.field(uploads).map(job => removeUpload.of(job.id)) });
      });
    }
    destroy() { views.clear(); }
  });
  return [uploads, placeholders, lifecycle, cleanup, EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1) return false;
      const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
      if (!files.length) return false;
      event.preventDefault();
      const selection = view.state.selection.main, id = Symbol('image import');
      const job: Upload = { id, from: selection.from, to: selection.to, original: view.state.sliceDoc(selection.from, selection.to), files,
        assets: files.map(() => null), error: false, pending: false };
      views.set(id, view); view.dispatch({ effects: setUpload.of(job) }); void run(view, id); return true;
    }
  })];
}
