import { EditorState } from '@codemirror/state';
import { describe, expect, test } from 'vitest';
import { createImageEmbedsExtension } from './imageEmbeds';
import { defaultImagesConfig } from './imageConfig';
import { createImageInventory } from './imageInventory';
import { imageFixture as doc } from '../../../../../scripts/benchmarks/workloads.mjs';
import { measure } from '../../../../../scripts/benchmarks/register';

const initial = EditorState.create({ doc, extensions: createImageEmbedsExtension(defaultImagesConfig) });
let sink: unknown;
function select500() {
  let state = initial;
  for (let i = 0; i < 500; i++) state = state.update({ selection: { anchor: i % 100 } }).state;
  return state;
}
describe('large image note (500 embeds)', () => {
  test('initial inventory', async ({ bench }) => {
    expect(createImageInventory(initial.doc).images).toHaveLength(500);
    await measure(bench, 'images-inventory', () => {
      sink = EditorState.create({ doc, extensions: createImageEmbedsExtension(defaultImagesConfig) });
    });
  });
  test('500 selection updates', async ({ bench }) => {
    const selected = select500();
    expect(selected.selection.main.anchor).toBe(99);
    expect(selected.doc).toBe(initial.doc);
    expect(createImageInventory(selected.doc).images).toHaveLength(500);
    await measure(bench, 'images-selection', () => { sink = select500(); });
  });
});
