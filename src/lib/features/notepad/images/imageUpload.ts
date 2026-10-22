import { StateEffect, StateField, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { StoredImageAsset } from '../model/types';
import type { ImagesConfig } from './imageConfig';
export interface Upload {
  id: symbol; from: number; to: number; original: string; files: File[];
  assets: (StoredImageAsset | null)[]; error: boolean; pending: boolean;
  errorMessage?: string;
  retryable?: boolean;
}
export const setUpload = StateEffect.define<Upload>();
export const removeUpload = StateEffect.define<symbol>();
export const uploads = StateField.define<readonly Upload[]>({
  create: () => [],
  update(value, tr) {
    const next = value.filter(job => {
      let touched = tr.isUserEvent('input.external-reset');
      tr.changes.iterChangedRanges((from, to) => {
        if (from <= job.to && to >= job.from) touched = true;
      });
      return !touched;
    }).map(job => ({ ...job, from: tr.changes.mapPos(job.from, 1), to: tr.changes.mapPos(job.to, -1) }));
    for (const effect of tr.effects) {
      if (effect.is(removeUpload)) { const index = next.findIndex(job => job.id === effect.value); if (index >= 0) next.splice(index, 1); }
      if (effect.is(setUpload)) { const index = next.findIndex(job => job.id === effect.value.id); if (index >= 0) next[index] = effect.value; else next.push(effect.value); }
    }
    return next.sort((a, b) => a.from - b.from);
  }
});
export async function runImageUpload(view: EditorView, id: symbol, config: ImagesConfig, isCurrent: () => boolean) {
    const job = view.state.field(uploads, false)?.find(job => job.id === id);
    if (!isCurrent() || !job || job.pending || job.retryable === false || view.state.readOnly) return;
    view.dispatch({ effects: setUpload.of({ ...job, pending: true, error: false }) });
    const results = await Promise.allSettled(job.files.map((file, index) => job.assets[index] ? Promise.resolve(job.assets[index]!) : config.storePastedImage(file)));
    const current = view.state.field(uploads, false)?.find(job => job.id === id);
    if (!isCurrent() || !current || view.state.readOnly) return;
    const assets = results.map(result => result.status === 'fulfilled' ? result.value : null);
    if (assets.some(asset => !asset)) {
      view.dispatch({ effects: setUpload.of({ ...current, assets, pending: false, error: true }) }); return;
    }
    if (view.state.sliceDoc(current.from, current.to) !== current.original) {
      view.dispatch({ effects: removeUpload.of(id) }); return;
    }
    const markdown = assets.map(asset => `![[${asset!.fileName}]]`).join('\n\n');
    view.dispatch({ changes: { from: current.from, to: current.to, insert: markdown },
      selection: { anchor: current.from + markdown.length }, effects: removeUpload.of(id), scrollIntoView: true,
      annotations: [Transaction.userEvent.of('input.image.paste'), isolateHistory.of('full')] });
  }
