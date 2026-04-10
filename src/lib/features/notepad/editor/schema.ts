import type {
  DOMOutputSpec,
  Mark as ProseMirrorMark,
  MarkSpec,
  Node as ProseMirrorNode,
  NodeSpec
} from 'prosemirror-model';
import { Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

function readTextAlign(dom: HTMLElement) {
  const style = dom.getAttribute('style') ?? '';
  const match = style.match(/text-align:\s*(left|center|right)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: 'block+'
  },
  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM(): DOMOutputSpec {
      return ['p', 0];
    }
  },
  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM(): DOMOutputSpec {
      return ['blockquote', 0];
    }
  },
  horizontal_rule: {
    attrs: {
      markup: { default: '---' }
    },
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM(): DOMOutputSpec {
      return ['hr'];
    }
  },
  heading: {
    attrs: {
      level: { default: 1 }
    },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      { tag: 'h4', attrs: { level: 4 } },
      { tag: 'h5', attrs: { level: 5 } },
      { tag: 'h6', attrs: { level: 6 } }
    ],
    toDOM(node: ProseMirrorNode): DOMOutputSpec {
      return [`h${node.attrs.level}`, 0];
    }
  },
  code_block: {
    attrs: {
      params: { default: '' }
    },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs(dom: Node | string) {
          if (!(dom instanceof HTMLPreElement)) {
            return { params: '' };
          }

          const code = dom.querySelector('code');
          const className = code?.getAttribute('class') ?? '';
          const match = className.match(/language-([A-Za-z0-9_-]+)/);
          return {
            params: match?.[1] ?? ''
          };
        }
      }
    ],
    toDOM(node: ProseMirrorNode): DOMOutputSpec {
      const params = typeof node.attrs.params === 'string' ? node.attrs.params.trim() : '';
      return [
        'pre',
        ['code', params ? { class: `language-${params}` } : {}, 0]
      ];
    }
  },
  ordered_list: {
    attrs: {
      order: { default: 1 },
      tight: { default: false }
    },
    content: 'list_item+',
    group: 'block',
    parseDOM: [
      {
        tag: 'ol',
        getAttrs(dom: Node | string) {
          if (!(dom instanceof HTMLOListElement)) {
            return { order: 1, tight: false };
          }

          return {
            order: dom.hasAttribute('start') ? Number(dom.getAttribute('start')) || 1 : 1,
            tight: dom.dataset.tight === 'true'
          };
        }
      }
    ],
    toDOM(node: ProseMirrorNode): DOMOutputSpec {
      const attrs: Record<string, string> = {};
      if (node.attrs.order !== 1) {
        attrs.start = String(node.attrs.order);
      }
      if (node.attrs.tight) {
        attrs['data-tight'] = 'true';
      }
      return ['ol', attrs, 0];
    }
  },
  bullet_list: {
    attrs: {
      bullet: { default: '-' },
      tight: { default: false }
    },
    content: 'list_item+',
    group: 'block',
    parseDOM: [
      {
        tag: 'ul',
        getAttrs(dom: Node | string) {
          if (!(dom instanceof HTMLUListElement)) {
            return { bullet: '-', tight: false };
          }

          return {
            bullet: dom.dataset.bullet || '-',
            tight: dom.dataset.tight === 'true'
          };
        }
      }
    ],
    toDOM(node: ProseMirrorNode): DOMOutputSpec {
      const attrs: Record<string, string> = {};
      if (node.attrs.bullet && node.attrs.bullet !== '-') {
        attrs['data-bullet'] = String(node.attrs.bullet);
      }
      if (node.attrs.tight) {
        attrs['data-tight'] = 'true';
      }

      const hasTasks =
        node.childCount > 0 &&
        Array.from({ length: node.childCount }).every((_, index) => node.child(index).attrs.checked != null);
      if (hasTasks) {
        attrs['data-task-list'] = 'true';
      }

      return ['ul', attrs, 0];
    }
  },
  list_item: {
    attrs: {
      checked: { default: null as boolean | null }
    },
    content: 'paragraph block*',
    defining: true,
    parseDOM: [
      {
        tag: 'li',
        getAttrs(dom: Node | string) {
          if (!(dom instanceof HTMLElement)) {
            return { checked: null };
          }

          const checked = dom.dataset.checked;
          if (checked === 'true') {
            return { checked: true };
          }
          if (checked === 'false') {
            return { checked: false };
          }
          return { checked: null };
        }
      }
    ],
    toDOM(node: ProseMirrorNode): DOMOutputSpec {
      const attrs: Record<string, string> = {};
      if (node.attrs.checked != null) {
        attrs['data-checked'] = node.attrs.checked ? 'true' : 'false';
      }
      return ['li', attrs, 0];
    }
  },
  image: {
    inline: true,
    group: 'inline',
    draggable: true,
    attrs: {
      src: {},
      alt: { default: null },
      title: { default: null }
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs(dom: Node | string) {
          if (!(dom instanceof HTMLImageElement)) {
            return null;
          }

          return {
            src: dom.getAttribute('src'),
            title: dom.getAttribute('title'),
            alt: dom.getAttribute('alt')
          };
        }
      }
    ],
    toDOM(node: ProseMirrorNode): DOMOutputSpec {
      return ['img', node.attrs];
    }
  },
  text: {
    group: 'inline'
  },
  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM(): DOMOutputSpec {
      return ['br'];
    }
  },
  ...tableNodes({
    tableGroup: 'block',
    cellContent: 'inline*',
    cellAttributes: {
      align: {
        default: null,
        getFromDOM(dom) {
          if (!(dom instanceof HTMLElement)) {
            return null;
          }

          return readTextAlign(dom);
        },
        setDOMAttr(value, attrs) {
          if (typeof value === 'string' && value.length > 0) {
            attrs.style = `text-align:${value}`;
          }
        }
      }
    }
  })
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: {
      href: {},
      title: { default: null }
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs(dom: Node | string) {
          if (!(dom instanceof HTMLAnchorElement)) {
            return null;
          }

          return {
            href: dom.getAttribute('href'),
            title: dom.getAttribute('title')
          };
        }
      }
    ],
    toDOM(node: ProseMirrorMark): DOMOutputSpec {
      return ['a', node.attrs, 0];
    }
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM(): DOMOutputSpec {
      return ['em', 0];
    }
  },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: () => null },
      {
        style: 'font-weight',
        getAttrs: (value: string) =>
          typeof value === 'string' && /^(bold(er)?|[5-9]\d{2,})$/.test(value) ? null : false
      }
    ],
    toDOM(): DOMOutputSpec {
      return ['strong', 0];
    }
  },
  code: {
    excludes: '_',
    parseDOM: [{ tag: 'code' }],
    toDOM(): DOMOutputSpec {
      return ['code', 0];
    }
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
    toDOM(): DOMOutputSpec {
      return ['s', 0];
    }
  }
};

export const notepadSchema = new Schema({
  nodes,
  marks
});

export type NotepadSchema = typeof notepadSchema;
