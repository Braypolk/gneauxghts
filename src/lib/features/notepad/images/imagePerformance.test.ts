import { EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';
import { createImageEmbedsExtension } from './imageEmbeds';
import { defaultImagesConfig } from './imageConfig';
import { imageState } from './imageState';

it('reuses a large-note inventory across pane selection updates', () => {
  const doc = Array.from({ length: 500 }, (_, index) => `${'Prose '.repeat(60)}\n\n![[image-${index}.png|200]]\n\n`).join('');
  const start = performance.now();
  let state = EditorState.create({ doc, extensions: createImageEmbedsExtension(defaultImagesConfig) });
  const parsed = performance.now();
  const inventory = state.field(imageState).images;
  expect(inventory).toHaveLength(500);
  for (let index = 0; index < 500; index++) {
    state = state.update({ selection: { anchor: index % 100 } }).state;
    expect(state.field(imageState).images).toBe(inventory);
  }
  console.info(JSON.stringify({ probe: 'image inventory', characters: doc.length, images: inventory.length,
    initialMs: +(parsed - start).toFixed(2), selectionUpdates: 500, selectionMs: +(performance.now() - parsed).toFixed(2) }));
});
