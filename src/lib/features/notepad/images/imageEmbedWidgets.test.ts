import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createImageEmbedsExtension } from './imageEmbeds';
import { defaultImagesConfig } from './imageConfig';
import { imageState, imageSourceEffect, selectedImage } from './imageState';
function state(doc: string) { return EditorState.create({ doc, extensions: createImageEmbedsExtension(defaultImagesConfig) }); }
describe('pane image rendering state', () => {
  it('keeps a whole image selection rendered and reveals explicitly edited source with a preview', () => {
    let current = state('before\n\n![[shot.png]]\n\nafter');
    const image = current.field(imageState).images[0];
    current = current.update({ selection: EditorSelection.range(image.from, image.to) }).state;
    expect(selectedImage(current)?.target.fileName).toBe('shot.png');
    const rendered = current.facet(EditorView.decorations)[0];
    expect(typeof rendered).not.toBe('function');
    current = current.update({ selection: { anchor: image.from + 3 }, effects: imageSourceEffect.of(image.from) }).state;
    expect(selectedImage(current)).toBeNull();
    expect(current.field(imageState).sourceFrom).toBe(image.from);
    current = current.update({ selection: { anchor: current.doc.length } }).state;
    expect(current.field(imageState).sourceFrom).toBeNull();
  });
  it('shares inventory on selection changes and keeps source state local to each pane', () => {
    const a = state('![[shot.png]]'), b = state('![[shot.png]]');
    const changed = a.update({ selection: { anchor: 4 }, effects: imageSourceEffect.of(0) }).state;
    expect(changed.field(imageState).images).toBe(a.field(imageState).images);
    expect(b.field(imageState).sourceFrom).toBeNull();
    expect(b.field(imageState).lifetime).not.toBe(a.field(imageState).lifetime);
  });
  it('maps explicit source mode through edits above the image', () => {
    let current = state('text\n\n![[shot.png]]');
    current = current.update({ selection: { anchor: 10 }, effects: imageSourceEffect.of(6) }).state;
    current = current.update({ changes: { from: 0, insert: 'more ' } }).state;
    expect(current.field(imageState).sourceFrom).toBe(11);
  });
});

it('retains the latest valid preview during an intermediate invalid destination', () => {
  let current = state('![[shot.png]]');
  current = current.update({ selection: EditorSelection.range(3, 11), effects: imageSourceEffect.of(0) }).state;
  current = current.update({ changes: { from: 3, to: 11, insert: 'b' }, selection: { anchor: 4 } }).state;
  expect(current.field(imageState).images).toHaveLength(0);
  expect(current.field(imageState).sourcePreview?.assetName).toBe('shot.png');
  expect(current.field(imageState).sourceFrom).toBe(0);
  current = current.update({ changes: { from: 4, insert: '.png' }, selection: { anchor: 8 } }).state;
  expect(current.field(imageState).sourcePreview?.assetName).toBe('b.png');
  current = current.update({ selection: { anchor: current.doc.length } }).state;
  expect(current.field(imageState).sourcePreview).toBeNull();
});
