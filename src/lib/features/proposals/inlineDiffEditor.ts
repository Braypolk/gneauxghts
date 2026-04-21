import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { draftly } from 'draftly/src/editor/draftly';
import { notepadDraftlyPlugins } from '$lib/features/notepad/editor/draftlyPlugins';

export interface InlineDiffEditorController {
  view: EditorView;
}

interface CreateInlineDiffEditorOptions {
  editorRoot: HTMLDivElement;
  currentMarkdown: string;
  proposedMarkdown: string;
  showRemovedContent?: boolean;
}

type DiffOp =
  | { kind: 'equal'; lines: string[] }
  | { kind: 'add'; lines: string[] }
  | { kind: 'remove'; lines: string[] };

class RemovedContentWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  override eq(other: RemovedContentWidget) {
    return this.text === other.text;
  }

  override toDOM() {
    const wrapper = document.createElement(this.text.includes('\n') ? 'div' : 'span');
    wrapper.className = this.text.includes('\n')
      ? 'proposal-inline-diff__removed proposal-inline-diff__removed-block'
      : 'proposal-inline-diff__removed';
    wrapper.textContent = this.text || '[deleted content]';
    return wrapper;
  }
}

function splitLines(text: string) {
  return text === '' ? [''] : text.split('\n');
}

function buildLineDiff(currentMarkdown: string, proposedMarkdown: string) {
  const currentLines = splitLines(currentMarkdown);
  const proposedLines = splitLines(proposedMarkdown);
  const rows = currentLines.length;
  const cols = proposedLines.length;
  const lcs = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      lcs[row][col] =
        currentLines[row] === proposedLines[col]
          ? lcs[row + 1][col + 1] + 1
          : Math.max(lcs[row + 1][col], lcs[row][col + 1]);
    }
  }

  const operations: DiffOp[] = [];
  let row = 0;
  let col = 0;
  const push = (kind: DiffOp['kind'], line: string) => {
    const previous = operations.at(-1);
    if (previous?.kind === kind) {
      previous.lines.push(line);
    } else {
      operations.push({ kind, lines: [line] } as DiffOp);
    }
  };

  while (row < rows && col < cols) {
    if (currentLines[row] === proposedLines[col]) {
      push('equal', currentLines[row]);
      row += 1;
      col += 1;
      continue;
    }

    if (lcs[row + 1][col] >= lcs[row][col + 1]) {
      push('remove', currentLines[row]);
      row += 1;
    } else {
      push('add', proposedLines[col]);
      col += 1;
    }
  }

  while (row < rows) {
    push('remove', currentLines[row]);
    row += 1;
  }
  while (col < cols) {
    push('add', proposedLines[col]);
    col += 1;
  }

  return operations;
}

function lineOffsets(text: string) {
  const lines = splitLines(text);
  const offsets = [];
  let offset = 0;

  for (const line of lines) {
    offsets.push({ from: offset, to: offset + line.length });
    offset += line.length + 1;
  }

  return offsets;
}

function createInlineDiffExtension(currentMarkdown: string, proposedMarkdown: string, showRemovedContent: boolean) {
  const operations = buildLineDiff(currentMarkdown, proposedMarkdown);

  return ViewPlugin.fromClass(
    class {
      decorations;

      constructor(readonly view: EditorView) {
        this.decorations = this.buildDecorations();
      }

      buildDecorations() {
        const builder = new RangeSetBuilder<Decoration>();
        const offsets = lineOffsets(this.view.state.doc.toString());
        let proposedLineIndex = 0;

        for (const operation of operations) {
          if (operation.kind === 'equal') {
            proposedLineIndex += operation.lines.length;
            continue;
          }

          if (operation.kind === 'add') {
            for (let index = 0; index < operation.lines.length; index += 1) {
              const lineOffset = offsets[proposedLineIndex + index];
              if (!lineOffset) {
                continue;
              }

              builder.add(
                lineOffset.from,
                lineOffset.to,
                Decoration.mark({ class: 'proposal-inline-diff__added' })
              );
            }
            proposedLineIndex += operation.lines.length;
            continue;
          }

          if (showRemovedContent) {
            const insertionLine = offsets[proposedLineIndex];
            const insertPos = insertionLine?.from ?? this.view.state.doc.length;
            builder.add(
              insertPos,
              insertPos,
              Decoration.widget({
                widget: new RemovedContentWidget(operation.lines.join('\n')),
                side: -1
              })
            );
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

export async function createInlineDiffEditor({
  editorRoot,
  currentMarkdown,
  proposedMarkdown,
  showRemovedContent = true
}: CreateInlineDiffEditorOptions) {
  const state = EditorState.create({
    doc: proposedMarkdown,
    extensions: [
      ...draftly({
        baseStyles: true,
        defaultKeybindings: false,
        history: false,
        lineWrapping: true,
        plugins: notepadDraftlyPlugins,
        extensions: [
          createInlineDiffExtension(currentMarkdown, proposedMarkdown, showRemovedContent),
          EditorView.theme({
            '&.cm-editor.cm-draftly': {
              background: 'transparent',
              border: 'none',
              height: 'auto'
            },
            '&.cm-editor.cm-draftly .cm-content': {
              padding: '1rem 0'
            }
          })
        ]
      }),
      EditorView.editable.of(false)
    ]
  });

  const view = new EditorView({
    state,
    parent: editorRoot
  });

  return { view } satisfies InlineDiffEditorController;
}

export async function destroyInlineDiffEditor(controller: InlineDiffEditorController | null) {
  if (!controller) {
    return null;
  }

  controller.view.destroy();
  return null;
}
