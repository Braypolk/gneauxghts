import { type ChangeSet, type Text, type Transaction } from '@codemirror/state';
import { TreeFragment, type ChangedRange, type Tree } from '@lezer/common';
import { parseImageEmbedDocument, type ImageEmbedMatch } from './imageEmbedParser';

interface ImageInventory {
  readonly bangs: number;
  readonly tree: Tree | null;
  readonly images: ImageEmbedMatch[];
}
const inventories = new WeakMap<Text, ImageInventory>();
// The runtime forwards the same ChangeSet to sibling panes, whose Text objects
// may differ. Weak values avoid retaining a version history through undo entries.
const transitions = new WeakMap<ChangeSet, {
  before: WeakRef<Text>;
  result: WeakRef<ImageInventory>;
}>();

function countBangs(doc: Text, from = 0, to = doc.length) {
  let count = 0;
  for (const chunk of doc.iterRange(from, to)) {
    for (let at = chunk.indexOf('!'); at !== -1; at = chunk.indexOf('!', at + 1)) count++;
  }
  return count;
}
function build(doc: Text, bangs: number, fragments: readonly TreeFragment[] = []): ImageInventory {
  return bangs === 0 ? { bangs, tree: null, images: [] }
    : { bangs, ...parseImageEmbedDocument(doc.toString(), fragments) };
}
export function createImageInventory(doc: Text): ImageInventory {
  let result = inventories.get(doc);
  if (!result) {
    result = build(doc, countBangs(doc));
    inventories.set(doc, result);
  }
  return result;
}
export function updateImageInventory(previous: ImageInventory, tr: Transaction): ImageInventory {
  const cached = inventories.get(tr.newDoc);
  if (cached) return cached;
  let bangs = previous.bangs;
  const ranges: ChangedRange[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    bangs += countBangs(inserted) - countBangs(tr.startState.doc, fromA, toA);
    ranges.push({ fromA, toA, fromB, toB });
  });
  // There is nothing expensive to share on this path. In particular, avoid
  // comparing entire sibling Text values just to share an empty result.
  if (bangs === 0) {
    const empty = build(tr.newDoc, bangs);
    inventories.set(tr.newDoc, empty);
    return empty;
  }
  const shared = transitions.get(tr.changes);
  const result = shared?.result.deref();
  // ChangeSet identity alone is insufficient: callers can apply it to other text.
  if (result && shared?.before.deref()?.eq(tr.startState.doc)) {
    inventories.set(tr.newDoc, result);
    return result;
  }
  const fragments = previous.tree
    ? TreeFragment.applyChanges(TreeFragment.addTree(previous.tree), ranges) : [];
  const next = build(tr.newDoc, bangs, fragments);
  inventories.set(tr.newDoc, next);
  transitions.set(tr.changes, { before: new WeakRef(tr.startState.doc), result: new WeakRef(next) });
  return next;
}
