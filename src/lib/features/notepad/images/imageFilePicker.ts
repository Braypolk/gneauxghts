import { StateEffect, StateField } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export interface ImageImportTarget {
  id: symbol;
  from: number;
  to: number;
  original: string;
}

const setPickerTarget = StateEffect.define<ImageImportTarget | null>();

/** Keep the command's destination attached to its originating editor while the chooser is open. */
export const imagePickerTarget = StateField.define<ImageImportTarget | null>({
  create: () => null,
  update(target, transaction) {
    if (target) {
      let touched = transaction.isUserEvent('input.external-reset') || transaction.state.readOnly;
      transaction.changes.iterChangedRanges((from, to) => {
        if (from <= target!.to && to >= target!.from) touched = true;
      });
      target = touched ? null : {
        ...target,
        from: transaction.changes.mapPos(target.from, 1),
        to: transaction.changes.mapPos(target.to, -1)
      };
    }
    for (const effect of transaction.effects) if (effect.is(setPickerTarget)) target = effect.value;
    return target;
  }
});

const imageMimeTypes = new Set([
  'image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/jpg',
  'image/png', 'image/svg+xml', 'image/webp'
]);
const imageExtensions = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
export const imageFileAccept = '.avif,.bmp,.gif,.jpg,.jpeg,.png,.svg,.webp';

export function isSupportedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type ? imageMimeTypes.has(file.type.toLowerCase()) : imageExtensions.test(file.name);
}

export interface ImageFileChoice {
  result: Promise<File[] | null>;
  cancel: () => void;
}

/** A file input opens the platform chooser and gives the existing importer File bytes on every platform. */
export function chooseImageFiles(ownerDocument: Document): ImageFileChoice {
  const input = ownerDocument.createElement('input');
  input.type = 'file';
  input.accept = imageFileAccept;
  input.multiple = true;
  input.hidden = true;
  input.dataset.imageFilePicker = '';
  let finish!: (files: File[] | null) => void;
  const result = new Promise<File[] | null>((resolve, reject) => {
    finish = (files) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    ownerDocument.body.append(input);
    try { input.click(); } catch (error) { input.remove(); reject(error); }
  });
  // A fresh input per invocation also permits choosing the same file again.
  return { result, cancel: () => finish(null) };
}

const controllers = new WeakMap<EditorView, ImageFilePickerController>();

export function openImageFilePicker(view: EditorView, range: { from: number; to: number } = view.state.selection.main): boolean {
  return controllers.get(view)?.open(range) ?? false;
}

export class ImageFilePickerController {
  #alive = true;
  #choice: ImageFileChoice | null = null;

  constructor(
    readonly view: EditorView,
    readonly submit: (target: ImageImportTarget, files: File[], error?: string) => void,
    readonly choose: () => ImageFileChoice = () => chooseImageFiles(view.dom.ownerDocument)
  ) {
    controllers.set(view, this);
  }

  open(range: { from: number; to: number }): boolean {
    if (!this.#alive || this.view.state.readOnly || this.view.composing || this.view.state.selection.ranges.length !== 1) return false;
    this.#choice?.cancel();
    const target = { id: Symbol('image picker'), from: range.from, to: range.to, original: this.view.state.sliceDoc(range.from, range.to) };
    this.view.dispatch({ effects: setPickerTarget.of(target) });
    let choice: ImageFileChoice;
    try { choice = this.choose(); }
    catch { this.#complete(target.id, null, 'Could not open the image picker.'); return true; }
    this.#choice = choice;
    void choice.result.then(
      (files) => this.#complete(target.id, files),
      () => this.#complete(target.id, null, 'Could not open the image picker.')
    );
    return true;
  }

  update() {
    if (!this.view.state.field(imagePickerTarget)) {
      this.#choice?.cancel();
      this.#choice = null;
    }
  }

  destroy() {
    this.#alive = false;
    this.#choice?.cancel();
    this.#choice = null;
    if (controllers.get(this.view) === this) controllers.delete(this.view);
  }

  #complete(id: symbol, files: File[] | null, error?: string) {
    if (!this.#alive) return;
    const target = this.view.state.field(imagePickerTarget, false);
    if (!target || target.id !== id || this.view.state.readOnly) return;
    this.#choice = null;
    this.view.dispatch({ effects: setPickerTarget.of(null) });
    if (files?.some((file) => !isSupportedImageFile(file))) {
      error = 'Choose an AVIF, BMP, GIF, JPEG, PNG, SVG or WebP image.';
    }
    if (error || files?.length) this.submit(target, error ? [] : files!, error);
    this.view.focus();
  }
}
