import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import type { MarkdownNodeDecorator } from './types';

// List decoration. Unlike draftly's flex+absolute layout (which broke
// goal-column arrow motion), list lines stay on normal block flow: indentation
// is applied as left padding driven by a `--gn-depth` CSS variable, so cursor
// up/down geometry is preserved and the ArrowUp/Down keymap exclusion can be
// dropped.

const TASK_MARKER_RE = /^(\s*(?:[-*+]|\d+\.)\s*)\[([ xX])\]/;

// Interactive checkbox shown in place of the raw `[ ]`/`[x]` task marker when
// the line is not being edited. Clicking toggles the marker char in the doc.
class TaskCheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = `cm-gn-task-checkbox${this.checked ? ' checked' : ''}`;
    wrap.setAttribute('aria-hidden', 'true');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.checked;
    checkbox.tabIndex = -1;
    checkbox.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.toggle(view, wrap);
    });

    wrap.appendChild(checkbox);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return false;
  }

  private toggle(view: EditorView, wrap: HTMLElement): void {
    const pos = view.posAtDOM(wrap);
    const line = view.state.doc.lineAt(pos);
    const match = line.text.match(TASK_MARKER_RE);
    if (!match) {
      return;
    }
    const markerStart = line.from + match[1].length + 1;
    view.dispatch({
      changes: { from: markerStart, to: markerStart + 1, insert: this.checked ? ' ' : 'x' }
    });
  }
}

function listItemDepth(node: SyntaxNodeRef): number {
  let depth = 0;
  let ancestor = node.node.parent;
  while (ancestor) {
    if (ancestor.name === 'ListItem') {
      depth++;
    }
    ancestor = ancestor.parent;
  }
  return depth;
}

function hasTaskChild(node: SyntaxNodeRef): boolean {
  const cursor = node.node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.name === 'Task') {
        return true;
      }
    } while (cursor.nextSibling());
  }
  return false;
}

export const decorateList: MarkdownNodeDecorator = (ctx, node) => {
  const { view, decorations } = ctx;

  switch (node.name) {
    case 'ListItem': {
      const line = view.state.doc.lineAt(node.from);
      const listType = node.node.parent?.name;
      const depth = listItemDepth(node);
      const isTask = hasTaskChild(node);

      const lineClass = isTask
        ? 'cm-gn-task-line'
        : listType === 'OrderedList'
          ? 'cm-gn-list-line-ol'
          : 'cm-gn-list-line-ul';

      decorations.push(
        Decoration.line({
          class: lineClass,
          attributes: { style: `--gn-depth: ${depth}` }
        }).range(line.from)
      );
      break;
    }

    case 'ListMark': {
      const line = view.state.doc.lineAt(node.from);
      const active = ctx.selectionOverlaps(line.from, line.to);
      const listType = node.node.parent?.parent?.name;
      const markClass = listType === 'OrderedList' ? 'cm-gn-list-mark-ol' : 'cm-gn-list-mark-ul';
      const activeSuffix = active ? ' cm-gn-active' : '';

      // Include the trailing space so the bullet/number column has consistent
      // width whether revealed or concealed.
      const markEnd = Math.min(node.to + 1, line.to);
      decorations.push(Decoration.mark({ class: markClass + activeSuffix }).range(node.from, markEnd));
      break;
    }

    case 'TaskMarker': {
      const line = view.state.doc.lineAt(node.from);
      const active = ctx.selectionOverlaps(line.from, line.to);
      if (active) {
        decorations.push(Decoration.mark({ class: 'cm-gn-task-marker' }).range(node.from, node.to));
      } else {
        const text = view.state.sliceDoc(node.from, node.to);
        const checked = /[xX]/.test(text);
        decorations.push(
          Decoration.replace({ widget: new TaskCheckboxWidget(checked) }).range(node.from, node.to)
        );
      }
      break;
    }
  }
};
