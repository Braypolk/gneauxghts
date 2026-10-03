/** Wiki embeds are one syntax node, including when nested in Markdown blocks. */
export const imageSyntaxExtension = {
  defineNodes: ['WikiImage'],
  parseInline: [{
    name: 'WikiImage',
    before: 'Image',
    parse(cx: { char(pos: number): number; end: number; slice(a: number, b: number): string;
      elt(name: string, a: number, b: number): {}; addElement(element: {}): number }, next: number, pos: number) {
      if (next !== 33 || cx.slice(pos, pos + 3) !== '![[') return -1;
      for (let end = pos + 3; end + 1 < cx.end; end++) {
        if (cx.char(end) === 10 || cx.char(end) === 91) return -1;
        if (cx.slice(end, end + 2) === ']]') {
          return cx.addElement(cx.elt('WikiImage', pos, end + 2));
        }
      }
      return -1;
    }
  }]
};
