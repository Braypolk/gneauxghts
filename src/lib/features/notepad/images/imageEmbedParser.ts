import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Selection, Transaction } from 'prosemirror-state';

const IMAGE_EMBED_PATTERN = /!\[\[([^\[\]\n]+?)\]\]/g;
const COMPLETE_IMAGE_EMBED_PATTERN = /!\[\[[^\[\]\n]+?\]\]/;
const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const IMAGE_SIZE_PATTERN = /^(?:(\d+)x(\d+)|(\d+)x|x(\d+)|(\d+))$/;

export interface ParsedImageEmbedTarget {
  fileName: string;
  width: number | null;
  height: number | null;
}

export interface ImageEmbedMatch {
  from: number;
  to: number;
  target: ParsedImageEmbedTarget;
  widgetKey: string;
}

export function isInCodeContext(selection: Selection) {
  const { $from } = selection;
  if ($from.parent.type.name === 'code_block') {
    return true;
  }

  return $from.marks().some((mark) => mark.type.name === 'code');
}

export function selectionTouchesEmbed(selection: Selection, from: number, to: number) {
  if (selection.empty) {
    return selection.from > from && selection.from < to;
  }

  return selection.from < to && selection.to > from;
}

function clampTextWindow(doc: ProseMirrorNode, start: number, end: number, padding = 48) {
  const maxPos = Math.max(0, doc.content.size);
  return {
    from: Math.max(0, start - padding),
    to: Math.min(maxPos, end + padding)
  };
}

function textWindowContainsImageEmbed(doc: ProseMirrorNode, start: number, end: number) {
  const { from, to } = clampTextWindow(doc, start, end);
  return COMPLETE_IMAGE_EMBED_PATTERN.test(doc.textBetween(from, to, '\n', '\n'));
}

export function transactionMayAffectImageEmbeds(
  transaction: Transaction,
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode
) {
  let affectsEmbeds = false;

  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (affectsEmbeds) {
        return;
      }

      if (
        textWindowContainsImageEmbed(oldDoc, oldStart, oldEnd) ||
        textWindowContainsImageEmbed(newDoc, newStart, newEnd)
      ) {
        affectsEmbeds = true;
      }
    });

    if (affectsEmbeds) {
      break;
    }
  }

  return affectsEmbeds;
}

export function formatImageEmbedTarget(target: ParsedImageEmbedTarget) {
  if (target.width != null && target.height != null) {
    return `![[${target.fileName}|${target.width}x${target.height}]]`;
  }

  if (target.width != null) {
    return `![[${target.fileName}|${target.width}]]`;
  }

  if (target.height != null) {
    return `![[${target.fileName}|x${target.height}]]`;
  }

  return `![[${target.fileName}]]`;
}

function parseImageEmbedTarget(rawTarget: string): ParsedImageEmbedTarget | null {
  const [rawFileName, rawSize] = rawTarget.split('|', 2).map((segment) => segment.trim());
  if (!rawFileName || !IMAGE_FILE_PATTERN.test(rawFileName)) {
    return null;
  }

  if (!rawSize) {
    return {
      fileName: rawFileName,
      width: null,
      height: null
    };
  }

  const sizeMatch = rawSize.match(IMAGE_SIZE_PATTERN);
  if (!sizeMatch) {
    return {
      fileName: rawFileName,
      width: null,
      height: null
    };
  }

  const width = sizeMatch[1] ?? sizeMatch[3] ?? sizeMatch[5] ?? null;
  const height = sizeMatch[2] ?? sizeMatch[4] ?? null;

  return {
    fileName: rawFileName,
    width: width ? Number.parseInt(width, 10) : null,
    height: height ? Number.parseInt(height, 10) : null
  };
}

export function forEachImageEmbed(doc: ProseMirrorNode, callback: (embed: ImageEmbedMatch) => void) {
  const occurrencesByRawTarget = new Map<string, number>();

  doc.descendants((node, position, parent) => {
    if (!node.isText || !node.text) {
      return;
    }

    if (
      parent?.type.name === 'code_block' ||
      node.marks.some((mark) => mark.type.name === 'code')
    ) {
      return;
    }

    for (const match of node.text.matchAll(IMAGE_EMBED_PATTERN)) {
      const index = match.index ?? -1;
      const rawTarget = match[1]?.trim();
      const target = rawTarget ? parseImageEmbedTarget(rawTarget) : null;

      if (index < 0 || !rawTarget || !target) {
        continue;
      }

      const occurrence = (occurrencesByRawTarget.get(rawTarget) ?? 0) + 1;
      occurrencesByRawTarget.set(rawTarget, occurrence);

      const from = position + index;
      const to = from + match[0].length;
      callback({
        from,
        to,
        target,
        widgetKey: `image-embed:${rawTarget}:${occurrence}`
      });
    }
  });
}

export function findTouchedImageEmbedKey(doc: ProseMirrorNode, selection: Selection) {
  if (isInCodeContext(selection)) {
    return null;
  }

  let activeWidgetKey: string | null = null;
  forEachImageEmbed(doc, (embed) => {
    if (activeWidgetKey || !selectionTouchesEmbed(selection, embed.from, embed.to)) {
      return;
    }

    activeWidgetKey = embed.widgetKey;
  });

  return activeWidgetKey;
}
