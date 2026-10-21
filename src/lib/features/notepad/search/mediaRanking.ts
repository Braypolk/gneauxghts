import type { ImageSearchItem, MediaSearchItem, SearchItem } from '#lib/types/semantic.js';

/** Channel ranks share one scale. Cosines from different modalities do not. */
export function rankMediaResults(passages: SearchItem[], images: ImageSearchItem[]): MediaSearchItem[] {
  const ranked = [
    ...passages.map((item, rank) => ({ item: { ...item, kind: 'passage' as const }, rank, channel: 0 })),
    ...images.map((item, rank) => ({ item, rank, channel: 1 }))
  ];
  ranked.sort((a, b) => (1 / (60 + b.rank + 1)) - (1 / (60 + a.rank + 1)) || a.channel - b.channel);
  return ranked.slice(0, 24).map(({ item }) => item);
}
