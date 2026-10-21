import { EditorState } from '@codemirror/state';
import { describe, test } from 'vitest';
import { createImageEmbedsExtension } from './imageEmbeds';
import { defaultImagesConfig } from './imageConfig';

const doc = Array.from({ length: 500 }, (_, i) => `${'Prose '.repeat(60)}\n\n![[image-${i}.png|200]]\n\n`).join('');
const initial = EditorState.create({ doc, extensions: createImageEmbedsExtension(defaultImagesConfig) });
describe('large image note (500 embeds)', () => {
  test('initial inventory', async ({ bench }) => {
    await bench('initial inventory', () => {
      EditorState.create({ doc, extensions: createImageEmbedsExtension(defaultImagesConfig) });
    }).run({ time: 150, iterations: 10 });
  });
  test('500 selection updates', async ({ bench }) => {
    await bench('500 selection updates', () => {
      let state = initial;
      for (let i = 0; i < 500; i++) state = state.update({ selection: { anchor: i % 100 } }).state;
    }).run({ time: 150, iterations: 10 });
  });
});
