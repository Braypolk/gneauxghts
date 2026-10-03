import type { EditorView } from '@codemirror/view';
import type { EditorSelection } from '@codemirror/state';
import type { ImageEmbedMatch } from './imageEmbedParser';
export interface ImageViewerSession {
  images: readonly ImageEmbedMatch[];
  index: number;
  load: (name: string, refresh?: boolean) => Promise<string>;
  subscribe: (close: () => void) => () => void;
  restore: () => void;
}
export function viewerFit(naturalWidth: number, naturalHeight: number, width: number, height: number) {
  return Math.min(1, width / Math.max(1, naturalWidth), height / Math.max(1, naturalHeight));
}
export function boundedPan(x: number, y: number, imageWidth: number, imageHeight: number, width: number, height: number) {
  const limitX = Math.max(0, (imageWidth - width) / 2), limitY = Math.max(0, (imageHeight - height) / 2);
  return { x: Math.min(limitX, Math.max(-limitX, x)), y: Math.min(limitY, Math.max(-limitY, y)) };
}
export function restoreImageOrigin(view: EditorView, lifetime: symbol, isCurrent: () => boolean,
  selection: EditorSelection, top: number, left: number) {
  if (!isCurrent()) return;
  view.focus();
  view.dispatch({ selection });
  view.scrollDOM.scrollTop = top; view.scrollDOM.scrollLeft = left;
  view.requestMeasure({ key: lifetime, read: () => null, write: () => {
    if (isCurrent()) { view.scrollDOM.scrollTop = top; view.scrollDOM.scrollLeft = left; }
  }});
}
