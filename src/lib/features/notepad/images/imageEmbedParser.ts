const IMAGE_EMBED_PATTERN = /!\[\[([^\[\]\n]+?)\]\]/g;
const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const IMAGE_SIZE_PATTERN = /^(?:(\d+)x(\d+)|(\d+)x|x(\d+)|(\d+))$/;
const FENCE_PATTERN = /^\s*(```+|~~~+)/;

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

function lineStarts(text: string) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && index + 1 <= text.length) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function isOffsetInsideCodeFence(text: string, offset: number, starts = lineStarts(text)) {
  let insideFence = false;

  for (const start of starts) {
    if (start > offset) {
      break;
    }

    const end = text.indexOf('\n', start);
    const line = text.slice(start, end === -1 ? text.length : end);
    if (FENCE_PATTERN.test(line)) {
      insideFence = !insideFence;
    }
  }

  return insideFence;
}

export function isPositionInsideCodeFence(text: string, offset: number) {
  return isOffsetInsideCodeFence(text, offset);
}

export function forEachImageEmbed(text: string, callback: (embed: ImageEmbedMatch) => void) {
  const occurrencesByRawTarget = new Map<string, number>();
  const starts = lineStarts(text);

  for (const match of text.matchAll(IMAGE_EMBED_PATTERN)) {
    const index = match.index ?? -1;
    const rawTarget = match[1]?.trim();
    const target = rawTarget ? parseImageEmbedTarget(rawTarget) : null;

    if (index < 0 || !rawTarget || !target || isOffsetInsideCodeFence(text, index, starts)) {
      continue;
    }

    const occurrence = (occurrencesByRawTarget.get(rawTarget) ?? 0) + 1;
    occurrencesByRawTarget.set(rawTarget, occurrence);

    callback({
      from: index,
      to: index + match[0].length,
      target,
      widgetKey: `image-embed:${rawTarget}:${occurrence}`
    });
  }
}
