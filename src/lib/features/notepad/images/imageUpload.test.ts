import { EditorState, StateEffect } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { describe, expect, it, vi } from 'vitest';
import { createCommandView } from '../editor/commandTestSupport';
import { uploads, setUpload, removeUpload, runImageUpload, type Upload } from './imageUpload';

function fixture(count = 1) {
  const { view } = createCommandView({ doc: 'before target after', selection: { anchor: 7, head: 13 }, extensions: [uploads, history()] });
  const files = Array.from({ length: count }, (_, i) => ({ name: `${i}.png` }) as File);
  const job: Upload = { id: Symbol(), from: 7, to: 13, original: 'target', files, assets: files.map(() => null), pending: false, error: false };
  view.dispatch({ effects: setUpload.of(job) }); return { view, job };
}
function asset(name: string) { return { fileName: name, filePath: `/vault/${name}` }; }

describe('view-owned image upload coordination', () => {
  it('retains successful assets and retries only failures as one authored undo step', async () => {
    const { view, job } = fixture(2);
    const storePastedImage = vi.fn().mockResolvedValueOnce(asset('a.png')).mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(asset('b.png'));
    const config = { assetRootPath: null, storePastedImage };
    await runImageUpload(view, job.id, config, () => true);
    expect(view.state.field(uploads)[0]).toMatchObject({ error: true, pending: false, assets: [asset('a.png'), null] });
    expect(view.state.doc.toString()).toBe('before target after');
    await runImageUpload(view, job.id, config, () => true);
    expect(storePastedImage.mock.calls.map(([file]) => file.name)).toEqual(['0.png', '1.png', '1.png']);
    expect(view.state.doc.toString()).toBe('before ![[a.png]]\n\n![[b.png]] after');
    expect(view.state.field(uploads)).toEqual([]); expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('before target after');
  });
  for (const retirement of ['cancel', 'overlap', 'destroy', 'readonly', 'external-reset']) {
    it(`rejects completion after ${retirement}`, async () => {
      const { view, job } = fixture(); let resolve!: (value: ReturnType<typeof asset>) => void;
      const config = { assetRootPath: null, storePastedImage: vi.fn(() => new Promise<ReturnType<typeof asset>>(yes => { resolve = yes; })) };
      let alive = true; const pending = runImageUpload(view, job.id, config, () => alive);
      if (retirement === 'cancel') view.dispatch({ effects: removeUpload.of(job.id) });
      if (retirement === 'overlap') view.dispatch({ changes: { from: 8, to: 9, insert: 'X' } });
      if (retirement === 'destroy') alive = false;
      if (retirement === 'readonly') view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
      if (retirement === 'external-reset') view.dispatch({ userEvent: 'input.external-reset' });
      const doc = view.state.doc.toString(); resolve(asset('late.png')); await pending;
      expect(view.state.doc.toString()).toBe(doc);
    });
  }
  it('maps an untouched upload through an unrelated edit and rejects duplicate execution', async () => {
    const { view, job } = fixture(); let resolve!: (value: ReturnType<typeof asset>) => void;
    const config = { assetRootPath: null, storePastedImage: vi.fn(() => new Promise<ReturnType<typeof asset>>(yes => { resolve = yes; })) };
    const pending = runImageUpload(view, job.id, config, () => true);
    await runImageUpload(view, job.id, config, () => true);
    view.dispatch({ changes: { from: 0, insert: 'new ' } }); resolve(asset('a.png')); await pending;
    expect(config.storePastedImage).toHaveBeenCalledOnce(); expect(view.state.doc.toString()).toBe('new before ![[a.png]] after');
  });
});
