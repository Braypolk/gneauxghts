import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { type ImageEmbedMatch } from './imageEmbedParser';
import { createImageInventory, updateImageInventory } from './imageInventory';
export const imageSourceEffect = StateEffect.define<number | null>();
export const imageState = StateField.define({
  create(state) {
    const inventory = createImageInventory(state.doc);
    return { inventory, images: inventory.images, sourceFrom: null as number | null, sourcePreview: null as ImageEmbedMatch | null, lifetime: Symbol('image view') };
  },
  update(value, tr) {
    const inventory = tr.docChanged ? updateImageInventory(value.inventory, tr) : value.inventory;
    const images = inventory.images;
    let sourceFrom = value.sourceFrom == null ? null : tr.changes.mapPos(value.sourceFrom, -1);
    for (const effect of tr.effects) if (effect.is(imageSourceEffect)) sourceFrom = effect.value;
    const selection = tr.newSelection.main;
    let sourcePreview = value.sourcePreview;
    if (sourcePreview && tr.docChanged) {
      const map = (pos: number, assoc = -1) => tr.changes.mapPos(pos, assoc);
      sourcePreview = { ...sourcePreview, from: map(sourcePreview.from), to: map(sourcePreview.to, 1),
        labelFrom: map(sourcePreview.labelFrom), labelTo: map(sourcePreview.labelTo, 1),
        sizeFrom: map(sourcePreview.sizeFrom), sizeTo: map(sourcePreview.sizeTo, 1),
        destinationFrom: map(sourcePreview.destinationFrom), destinationTo: map(sourcePreview.destinationTo, 1) };
      sourcePreview.source = tr.newDoc.sliceString(sourcePreview.from, sourcePreview.to);
    }
    const source = images.find(image => image.from === sourceFrom) ??
      (sourcePreview?.from === sourceFrom ? sourcePreview : null);
    sourcePreview = source ?? null;
    if (!source || (selection.empty && (selection.head <= source.from || selection.head >= source.to)) || selection.to < source.from || selection.from > source.to ||
      (selection.from === source.from && selection.to === source.to)) sourceFrom = null;
    if (tr.isUserEvent('input.external-reset')) sourceFrom = null;
    return { inventory, images, sourceFrom, sourcePreview: sourceFrom == null ? null : sourcePreview, lifetime: value.lifetime };
  }
});
export function selectedImage(state: EditorState) {
  if (state.selection.ranges.length !== 1) return null;
  const model = state.field(imageState, false);
  const selection = state.selection.main;
  return model?.images.find(image => image.from === selection.from && image.to === selection.to && model.sourceFrom !== image.from) ?? null;
}
export function imageShowsSource(state: EditorState, image: ImageEmbedMatch) {
  const model = state.field(imageState);
  return model.sourceFrom === image.from || state.selection.ranges.some(range =>
    (range.empty ? range.from > image.from && range.from < image.to :
      range.from < image.to && range.to > image.from && !(range.from === image.from && range.to === image.to)));
}
