import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';
import { languages } from '$lib/vendor/codemirrorLanguageData';

// CodeMirror markdown language support, configured to mirror the behaviour the
// editor relied on from draftly:
//  - `base: markdownLanguage` selects the GFM-enabled dialect (strikethrough,
//    task lists, tables, autolinks) rather than plain CommonMark.
//  - `codeLanguages` drives fenced-code-block syntax highlighting via lazily
//    loaded language parsers (see codemirrorLanguageData for the curated list).
//  - `pasteURLAsLink` keeps the "paste a URL over a selection → link" affordance.
//
// `addKeymap: false` — the language must NOT auto-install its own Markdown
// keymap. editor.ts registers the markdown editing keys explicitly (a single
// authoritative Enter handler plus the markdown Backspace). Leaving addKeymap at
// its default (true) registered the Markdown Enter binding a SECOND time, which
// combined with the browser's native contentEditable Enter to insert more than
// one newline. One keymap source, one Enter handler.
export function createMarkdownLanguage(): Extension {
  return markdown({
    base: markdownLanguage,
    codeLanguages: [...languages],
    completeHTMLTags: true,
    pasteURLAsLink: true,
    addKeymap: false
  });
}
