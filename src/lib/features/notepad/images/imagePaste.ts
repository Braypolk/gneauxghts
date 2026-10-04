import { uploads, setUpload, removeUpload, runImageUpload, type Upload } from './imageUpload';
import { StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ImagesConfig } from './imageConfig';
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
  function run(view: EditorView, id: symbol) {
    const owner = view.plugin(lifecycle);
    return runImageUpload(view, id, config, () => !!owner?.alive && view.plugin(lifecycle) === owner);
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
