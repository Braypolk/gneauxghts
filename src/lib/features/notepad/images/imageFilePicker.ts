import { StateEffect, StateField } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '#lib/tauriRuntime.js';

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

// Mirrors the asset MIME contract used by the native chooser and renderer.
const imageTypes: Record<string, string> = {
  avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp'
};
export const imageFileAccept = Object.entries(imageTypes).flatMap(([extension, mime]) => [`.${extension}`, mime]).join(',');

export function isSupportedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  const extension = /^.+\.([^.]+)$/.exec(file.name)?.[1].toLowerCase() ?? '';
  const expectedMime = Object.hasOwn(imageTypes, extension) ? imageTypes[extension] : undefined;
  const mime = file.type.toLowerCase().replace(/^image\/jpg$/, 'image/jpeg');
  return !!expectedMime && (!mime || mime === expectedMime);
}

export interface ImageFileChoice {
  result: Promise<File[] | null>;
  cancel: () => void;
}

interface PickedImageFile { name: string; mimeType: string; bytes: number[] }

export function chooseNativeImageFiles(request: () => Promise<PickedImageFile[] | null> = () => invoke('choose_image_files')): ImageFileChoice {
  let cancel!: () => void;
  let canceled = false;
  const result = new Promise<File[] | null>((resolve, reject) => {
    cancel = () => { canceled = true; resolve(null); };
    void request().then((images) => {
      if (canceled) return null;
      return images?.map((image) => new File([Uint8Array.from(image.bytes)], image.name, { type: image.mimeType })) ?? null;
    }).then(resolve, reject);
  });
  return { result, cancel };
}

function isMobileFilePickerPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Desktop native dialogs enforce the image filter; WebView inputs preserve the same allowlist on mobile. */
export function chooseImageFiles(ownerDocument: Document): ImageFileChoice {
  // Mobile dialog providers may broaden exact image filters to a media library
  // or return content:// handles. A WebView file input supplies usable File bytes
  // without widening permissions, and the controller validates its selection.
  if (isTauriRuntime() && import.meta.env.VITE_E2E_BROWSER !== 'true' && !isMobileFilePickerPlatform()) return chooseNativeImageFiles();
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
