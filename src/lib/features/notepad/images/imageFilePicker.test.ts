import { EditorState, StateEffect } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { createCommandView } from '../editor/commandTestSupport';
import { getSlashMenuState, runSlashMenuSelection } from '../editor/slashMenu';
import {
  ImageFilePickerController, chooseImageFiles, imageFileAccept, imagePickerTarget,
  isSupportedImageFile, openImageFilePicker, type ImageFileChoice
} from './imageFilePicker';

const png = () => ({ name: 'diagram.png', type: 'image/png' }) as File;
function fixture() {
  const { view } = createCommandView({ doc: 'Before /image after', selection: { anchor: 13 }, extensions: [imagePickerTarget] });
  const submit = vi.fn();
  let finish!: (files: File[] | null) => void;
  const cancel = vi.fn(() => finish(null));
  const choose = vi.fn((): ImageFileChoice => ({ result: new Promise((resolve) => { finish = resolve; }), cancel }));
  const controller = new ImageFilePickerController(view, submit, choose);
  return { view, controller, submit, choose, cancel, finish: (files: File[] | null) => finish(files) };
}
const settle = () => Promise.resolve();

describe('image file chooser ownership', () => {
  it('offers image insertion inline and opens it with the slash token as the replacement range', async () => {
    expect(getSlashMenuState('image', false).groups[0].items).toMatchObject([{ id: 'image' }]);
    expect(getSlashMenuState('table', false).size).toBe(0);
    expect(getSlashMenuState('table', true).groups[0].items).toMatchObject([{ id: 'table' }]);
    const f = fixture();
    runSlashMenuSelection(f.view, 'image');
    expect(f.choose).toHaveBeenCalledOnce();
    expect(f.view.state.doc.toString()).toBe('Before /image after');
    f.finish([png()]); await settle();
    expect(f.submit).toHaveBeenCalledWith(expect.objectContaining({ from: 7, to: 13, original: '/image' }), [png()], undefined);
  });

  it('keeps the command text and maps its destination through unrelated edits and selection changes', async () => {
    const f = fixture();
    expect(openImageFilePicker(f.view, { from: 7, to: 13 })).toBe(true);
    expect(f.view.state.doc.toString()).toBe('Before /image after');
    f.view.dispatch({ changes: { from: 0, insert: 'New ' }, selection: { anchor: 0 } });
    f.finish([png()]); await settle();
    expect(f.submit).toHaveBeenCalledWith(expect.objectContaining({ from: 11, to: 17, original: '/image' }), [png()], undefined);
    expect(f.view.state.field(imagePickerTarget)).toBeNull();
  });

  for (const retirement of ['overlap', 'external-reset', 'readonly', 'destroy']) {
    it(`does not import after ${retirement}`, async () => {
      const f = fixture();
      openImageFilePicker(f.view, { from: 7, to: 13 });
      if (retirement === 'overlap') f.view.dispatch({ changes: { from: 8, to: 9, insert: 'X' } });
      if (retirement === 'external-reset') f.view.dispatch({ userEvent: 'input.external-reset' });
      if (retirement === 'readonly') f.view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
      if (retirement === 'destroy') f.controller.destroy(); else f.controller.update();
      f.finish([png()]); await settle();
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.view.focus).not.toHaveBeenCalled();
    });
  }

  it('cancel keeps authored text and imports nothing', async () => {
    const f = fixture();
    openImageFilePicker(f.view, { from: 7, to: 13 });
    f.finish(null); await settle();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.view.state.doc.toString()).toBe('Before /image after');
    expect(f.view.state.field(imagePickerTarget)).toBeNull();
  });

  it('supersedes an older chooser and does not apply its eventual selection', async () => {
    const f = fixture();
    openImageFilePicker(f.view, { from: 7, to: 13 });
    openImageFilePicker(f.view, { from: 0, to: 0 });
    await settle();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.submit).not.toHaveBeenCalled();
    f.finish([png()]); await settle();
    expect(f.submit).toHaveBeenCalledWith(expect.objectContaining({ from: 0, to: 0 }), [png()], undefined);
  });

  it('surfaces chooser and unsupported-file failures without importing or replacing text', async () => {
    const f = fixture();
    f.choose.mockImplementationOnce(() => { throw new Error('blocked'); });
    openImageFilePicker(f.view, { from: 7, to: 13 });
    expect(f.submit).toHaveBeenLastCalledWith(expect.objectContaining({ original: '/image' }), [], 'Could not open the image picker.');
    openImageFilePicker(f.view, { from: 7, to: 13 });
    f.finish([{ name: 'notes.txt', type: 'text/plain' } as File]); await settle();
    expect(f.submit).toHaveBeenLastCalledWith(expect.objectContaining({ original: '/image' }), [], expect.stringContaining('Choose an'));
    expect(f.view.state.doc.toString()).toBe('Before /image after');
  });
});

describe('platform file input', () => {
  function documentFixture() {
    const listeners: Record<string, () => void> = {};
    const input = { addEventListener: vi.fn((type: string, callback: () => void) => { listeners[type] = callback; }),
      dataset: {}, remove: vi.fn(), click: vi.fn(), files: [png()] };
    const doc = { createElement: vi.fn(() => input), body: { append: vi.fn() } };
    return { doc: doc as unknown as Document, input, listeners };
  }

  it('opens the real input with image filters and cleans up after selection or cancel', async () => {
    const f = documentFixture();
    const choice = chooseImageFiles(f.doc);
    expect(f.input).toMatchObject({ type: 'file', accept: imageFileAccept, multiple: true, hidden: true });
    expect(f.input.click).toHaveBeenCalledOnce();
    f.listeners.change();
    expect(await choice.result).toEqual([png()]);
    expect(f.input.remove).toHaveBeenCalledOnce();
    const second = documentFixture();
    const canceled = chooseImageFiles(second.doc);
    second.listeners.cancel();
    expect(await canceled.result).toBeNull();
    expect(second.input.remove).toHaveBeenCalledOnce();
  });

  it('accepts backend-supported image types and falls back to filename only when MIME is absent', () => {
    for (const type of ['image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'])
      expect(isSupportedImageFile({ name: 'image', type })).toBe(true);
    expect(isSupportedImageFile({ name: 'DIAGRAM.PNG', type: '' })).toBe(true);
    expect(isSupportedImageFile({ name: 'notes.png', type: 'text/plain' })).toBe(false);
    expect(isSupportedImageFile({ name: 'notes.txt', type: '' })).toBe(false);
  });
});
