import { uploads, setUpload, removeUpload, runImageUpload, type Upload } from './imageUpload';
import { StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { ImagesConfig } from './imageConfig';
import { ImageFilePickerController, imagePickerTarget } from './imageFilePicker';
class UploadWidget extends WidgetType {
  constructor(readonly job: Upload, readonly retry: () => void, readonly cancel: () => void) { super(); }
  override eq(other: UploadWidget) { return this.job.id === other.job.id && this.job.error === other.job.error && this.job.pending === other.job.pending && this.job.errorMessage === other.job.errorMessage; }
  override toDOM() {
    const element = document.createElement('span'); element.className = 'gn-image-upload-placeholder'; element.contentEditable = 'false';
    element.setAttribute('role', this.job.error ? 'alert' : 'status'); element.textContent = this.job.error ? `${this.job.errorMessage ?? 'Image save failed.'} ` : 'Saving image… ';
    for (const [label, run] of [...(this.job.error && this.job.retryable !== false ? [['Retry', this.retry] as const] : []), ['Cancel', this.cancel] as const]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.onclick = event => { event.preventDefault(); event.stopPropagation(); run(); }; element.append(button);
    }
    return element;
  }
  override ignoreEvent() { return true; }
}
export function createImagePasteExtension(config: ImagesConfig) {
  const lifecycle = ViewPlugin.fromClass(class {
    alive = true;
    readonly picker: ImageFilePickerController;
    constructor(view: EditorView) {
      this.picker = new ImageFilePickerController(view, (target, files, errorMessage) => {
        const job: Upload = { ...target, files, assets: files.map(() => null), pending: false, error: !!errorMessage,
          ...(errorMessage ? { errorMessage, retryable: false } : {}) };
        submit(view, job);
      });
    }
    update() { this.picker.update(); }
    destroy() { this.alive = false; this.picker.destroy(); }
  });
  function find(view: EditorView, id: symbol) { return view.state.field(uploads, false)?.find(job => job.id === id); }
  function run(view: EditorView, id: symbol) {
    const owner = view.plugin(lifecycle);
    return runImageUpload(view, id, config, () => !!owner?.alive && view.plugin(lifecycle) === owner);
  }
  function submit(view: EditorView, job: Upload) {
    views.set(job.id, view);
    view.dispatch({ effects: setUpload.of(job) });
    if (!job.error) void run(view, job.id);
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
  function importFiles(view: EditorView, files: File[], from: number, to: number) {
    const id = Symbol('image import');
    const job: Upload = { id, from, to, original: view.state.sliceDoc(from, to), files,
      assets: files.map(() => null), error: false, pending: false };
    submit(view, job);
  }
  return [uploads, imagePickerTarget, placeholders, lifecycle, cleanup, EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1) return false;
      const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'));
      if (!files.length) return false;
      event.preventDefault();
      const selection = view.state.selection.main;
      importFiles(view, files, selection.from, selection.to); return true;
    },
    dragover(event, view) {
      if (view.state.readOnly || view.composing || !event.dataTransfer?.types.includes('Files')) return false;
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; return true;
    },
    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? []).filter(file => file.type.startsWith('image/'));
      if (!files.length) return false;
      // Consume image files before CodeMirror's default file drop reads their bytes as text.
      event.preventDefault();
      if (view.state.readOnly || view.composing) return true;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
      if (position !== null) {
        view.focus(); importFiles(view, files, position, position);
      }
      return true;
    }
  })];
}
