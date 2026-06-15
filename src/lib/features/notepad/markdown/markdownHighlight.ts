import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';

// Syntax highlighting for fenced code blocks. lang-markdown parses nested code
// with the matching language's Lezer parser; this HighlightStyle assigns the
// resulting tags to CSS variables defined in editor.css so colors track the app
// theme. Markdown's own structural tags (headings, emphasis, lists, links) are
// intentionally NOT colored here — those are styled in-place by the decoration
// plugins, and the reset below keeps the raw markup visually neutral.
const codeHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--gn-code-keyword)' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: 'var(--gn-code-name)' },
  { tag: [t.propertyName], color: 'var(--gn-code-property)' },
  { tag: [t.variableName], color: 'var(--gn-code-variable)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--gn-code-function)' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: 'var(--gn-code-constant)' },
  { tag: [t.definition(t.name), t.separator], color: 'var(--gn-code-name)' },
  {
    tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: 'var(--gn-code-type)'
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: 'var(--gn-code-operator)'
  },
  { tag: [t.string, t.inserted], color: 'var(--gn-code-string)' },
  { tag: [t.meta, t.comment], color: 'var(--gn-code-comment)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--gn-code-invalid)' }
]);

// Keep markdown's structural tokens visually neutral so the in-place decoration
// styling (bold/italic/headings/links) is the single source of appearance.
const markdownResetStyle = HighlightStyle.define([
  {
    tag: [
      t.heading,
      t.strong,
      t.emphasis,
      t.strikethrough,
      t.link,
      t.url,
      t.quote,
      t.list,
      t.meta,
      t.contentSeparator,
      t.labelName
    ],
    color: 'inherit',
    fontWeight: 'inherit',
    fontStyle: 'inherit',
    textDecoration: 'none'
  }
]);

export function createMarkdownHighlight(): Extension {
  return [
    syntaxHighlighting(markdownResetStyle, { fallback: false }),
    syntaxHighlighting(codeHighlightStyle)
  ];
}
