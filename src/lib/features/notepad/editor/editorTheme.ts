import { EditorView } from '@codemirror/view';

export function createLayoutTheme() {
  return EditorView.theme({
    '&.cm-editor.cm-gn': {
      height: '100%',
      minHeight: '100%',
      width: '100%',
      maxWidth: '100%',
      minWidth: '0',
      border: 'none',
      outline: 'none',
      background: 'transparent'
    },
    '&.cm-editor.cm-gn.cm-focused': {
      outline: 'none'
    },
    '&.cm-editor.cm-gn .cm-cursor, &.cm-editor.cm-gn .cm-dropCursor': {
      borderLeftColor: 'var(--foreground) !important'
    },
    '&.cm-editor.cm-gn .cm-scroller': {
      fontFamily: 'inherit',
      lineHeight: '1.75',
      width: '100%',
      maxWidth: '100%',
      minWidth: '0',
      overflowX: 'hidden',
      overflowY: 'auto'
    },
    '&.cm-editor.cm-gn .cm-content, &.cm-editor.cm-gn .cm-content.cm-lineWrapping':
      {
        boxSizing: 'border-box',
        minHeight: '100%',
        minWidth: '0',
        /*
         * Cap the column at the readable measure. CodeMirror's base theme sets
         * flex-grow: 2 on .cm-content, which otherwise stretches past `width`
         * up to max-width: 100% and makes note prose wider than chat.
         */
        flexGrow: '0',
        flexShrink: '1',
        width:
          'min(100%, calc(var(--content-readable-width) + var(--editor-left-padding) + var(--editor-handle-lane-width) + var(--editor-right-padding)))',
        maxWidth:
          'min(100%, calc(var(--content-readable-width) + var(--editor-left-padding) + var(--editor-handle-lane-width) + var(--editor-right-padding)))',
        margin: '0 auto',
        paddingTop: 'calc(var(--editor-top-padding) + var(--editor-tags-height, 0px))',
        paddingLeft: '0',
        paddingRight: '0',
        paddingBottom: 'var(--editor-bottom-padding)',
        '--gn-editor-side-inset-left':
          'calc(var(--editor-left-padding) + var(--editor-handle-lane-width))',
        '--gn-editor-side-inset-right': 'var(--editor-right-padding)',
        color: 'var(--foreground)',
        caretColor: 'var(--foreground)',
        overflowAnchor: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere'
      },
    '&.cm-editor.cm-gn .cm-line': {
      paddingLeft: 'var(--gn-editor-side-inset-left)',
      paddingRight: 'var(--gn-editor-side-inset-right)',
      maxWidth: '100%',
      minWidth: '0',
      boxSizing: 'border-box'
    },
    '&.cm-editor.cm-gn .cm-gn-quote-line': {
      paddingLeft:
        'calc(var(--gn-editor-side-inset-left) + 1rem) !important'
    },
    '&.cm-editor.cm-gn .cm-gn-code-block-line': {
      paddingLeft:
        'calc(var(--gn-editor-side-inset-left) + 0.85rem) !important',
      paddingRight:
        'calc(var(--gn-editor-side-inset-right) + 0.85rem) !important'
    },
    '&.cm-editor.cm-gn .cm-gn-list-line-ul, &.cm-editor.cm-gn .cm-gn-list-line-ol, &.cm-editor.cm-gn .cm-gn-task-line':
      {
        paddingLeft:
          'calc(var(--gn-editor-side-inset-left) + 1.2rem * (var(--gn-depth, 0) + 1)) !important'
      },
    '&.cm-editor.cm-gn .gn-markdown-table-line': {
      boxSizing: 'border-box',
      width:
        'calc(100% - var(--gn-editor-side-inset-left) - var(--gn-editor-side-inset-right))',
      maxWidth:
        'calc(100% - var(--gn-editor-side-inset-left) - var(--gn-editor-side-inset-right))',
      minWidth: '0',
      marginLeft: 'var(--gn-editor-side-inset-left)',
      marginRight: 'var(--gn-editor-side-inset-right)',
      paddingLeft: '0.75rem !important',
      paddingRight: '0.75rem !important',
      overflowX: 'auto',
      overflowY: 'hidden',
      whiteSpace: 'pre',
      wordBreak: 'normal',
      overflowWrap: 'normal',
      fontFamily:
        'var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      fontSize: '0.92em',
      lineHeight: '1.7',
      color: 'var(--foreground)',
      backgroundColor:
        'color-mix(in oklab, var(--card) 76%, var(--background))',
      boxShadow:
        'inset 0 -1px 0 color-mix(in oklab, var(--border) 72%, transparent)',
      scrollbarWidth: 'none'
    },
    '&.cm-editor.cm-gn .gn-markdown-table-line::-webkit-scrollbar': {
      height: '0'
    },
    '&.cm-editor.cm-gn .gn-markdown-table-line-end': {
      scrollbarWidth: 'thin'
    },
    '&.cm-editor.cm-gn .gn-markdown-table-line-end::-webkit-scrollbar': {
      height: '6px'
    },
    '&.cm-editor.cm-gn .gn-markdown-table-line-end::-webkit-scrollbar-thumb':
      {
        background:
          'color-mix(in oklab, var(--muted-foreground) 42%, transparent)',
        borderRadius: '999px'
      },
    '&.cm-editor.cm-gn .gn-markdown-table-header': {
      fontWeight: '650',
      color: 'var(--foreground)',
      backgroundColor:
        'color-mix(in oklab, var(--card) 88%, var(--foreground) 4%)',
      boxShadow:
        'inset 0 1px 0 color-mix(in oklab, var(--border) 76%, transparent), inset 0 -1px 0 color-mix(in oklab, var(--border) 82%, transparent)'
    },
    '&.cm-editor.cm-gn .gn-markdown-table-delimiter': {
      color: 'var(--muted-foreground)',
      backgroundColor:
        'color-mix(in oklab, var(--muted) 28%, var(--background))'
    }
  });
}

export function createOverlayScrollMargins(editorRoot: HTMLDivElement) {
  return EditorView.scrollMargins.of((view) => {
    const topOverlay = editorRoot
      .closest('[role="group"]')
      ?.querySelector<HTMLElement>('.notepad-editor-top-overlay');

    if (!topOverlay) {
      return null;
    }

    const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
    const overlayBottom = topOverlay.getBoundingClientRect().bottom;
    const top = Math.max(0, Math.ceil(overlayBottom - scrollerTop));

    return top > 0 ? { top } : null;
  });
}
