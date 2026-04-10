import { ChangeSet, simplifyChanges } from 'prosemirror-changeset';
import { DOMSerializer, type Node as ProseMirrorNode, type Slice as ProseMirrorSlice } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { StepMap } from 'prosemirror-transform';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { parseMarkdown } from '$lib/features/notepad/editor/markdown';
import { notepadSchema } from '$lib/features/notepad/editor/schema';

const inlineDiffPluginKey = new PluginKey('proposal-inline-diff');

export interface InlineDiffEditorController {
  view: EditorView;
}

interface CreateInlineDiffEditorOptions {
  editorRoot: HTMLDivElement;
  currentMarkdown: string;
  proposedMarkdown: string;
  showRemovedContent?: boolean;
}

function createEditorDocument(markdown: string) {
  const normalized = markdown.trim() === '' ? '\n' : markdown;
  const doc = parseMarkdown(normalized);
  if (doc.childCount > 0) {
    return doc;
  }

  return notepadSchema.node('doc', null, [notepadSchema.node('paragraph')]);
}

export async function createInlineDiffEditor({
  editorRoot,
  currentMarkdown,
  proposedMarkdown,
  showRemovedContent = true
}: CreateInlineDiffEditorOptions) {
  const state = EditorState.create({
    schema: notepadSchema,
    doc: createEditorDocument(proposedMarkdown),
    plugins: [createInlineDiffPlugin(currentMarkdown, showRemovedContent)]
  });

  const view = new EditorView(editorRoot, {
    state,
    editable: () => false
  });

  return {
    view
  } satisfies InlineDiffEditorController;
}

export async function destroyInlineDiffEditor(
  controller: InlineDiffEditorController | null
) {
  if (!controller) {
    return null;
  }

  controller.view.destroy();
  return null;
}

function createInlineDiffPlugin(currentMarkdown: string, showRemovedContent: boolean) {
  const currentDoc = createEditorDocument(currentMarkdown);

  return new Plugin({
    key: inlineDiffPluginKey,
    props: {
      decorations: (state) => {
        const decorations = buildInlineDiffDecorations(
          currentDoc,
          state.doc,
          showRemovedContent
        );

        return decorations.length === 0
          ? DecorationSet.empty
          : DecorationSet.create(state.doc, decorations);
      }
    }
  });
}

function buildInlineDiffDecorations(
  currentDoc: ProseMirrorNode,
  proposedDoc: ProseMirrorNode,
  showRemovedContent: boolean
) {
  const changes = simplifyChanges(
    ChangeSet.create(currentDoc)
      .addSteps(
        proposedDoc,
        [new StepMap([0, currentDoc.content.size, proposedDoc.content.size])],
        null
      )
      .changes,
    proposedDoc
  );

  const decorations: Decoration[] = [];

  for (const change of changes) {
    if (change.fromB < change.toB) {
      decorations.push(
        Decoration.inline(change.fromB, change.toB, {
          class: 'proposal-inline-diff__added'
        })
      );
    }

    if (showRemovedContent && change.fromA < change.toA) {
      const deletedSlice = currentDoc.slice(change.fromA, change.toA);

      decorations.push(
        Decoration.widget(
          change.fromB,
          () => createDeletedWidget(currentDoc, deletedSlice),
          {
            side: -1,
            ignoreSelection: true
          }
        )
      );
    }
  }

  return decorations;
}

function inferDeletedLabel(deletedSlice: ProseMirrorSlice) {
  if (deletedSlice.content.size === 0) {
    return '[deleted content]';
  }

  const firstNode = deletedSlice.content.firstChild;
  if (!firstNode) {
    return '[deleted content]';
  }

  return `[deleted ${firstNode.type.name}]`;
}

function createDeletedWidget(doc: ProseMirrorNode, deletedSlice: ProseMirrorSlice) {
  const hasBlockContent = sliceHasBlockContent(deletedSlice);
  const wrapper = document.createElement(hasBlockContent ? 'div' : 'span');
  wrapper.className = hasBlockContent
    ? 'proposal-inline-diff__removed proposal-inline-diff__removed-block'
    : 'proposal-inline-diff__removed';

  if (deletedSlice.content.size === 0) {
    wrapper.textContent = '[deleted content]';
    return wrapper;
  }

  const fragment = DOMSerializer.fromSchema(doc.type.schema).serializeFragment(
    deletedSlice.content
  );

  if (fragment.childNodes.length === 0) {
    wrapper.textContent = inferDeletedLabel(deletedSlice);
    return wrapper;
  }

  wrapper.appendChild(fragment);
  return wrapper;
}

function sliceHasBlockContent(deletedSlice: ProseMirrorSlice) {
  for (let index = 0; index < deletedSlice.content.childCount; index += 1) {
    if (deletedSlice.content.child(index)?.isBlock) {
      return true;
    }
  }

  return false;
}
