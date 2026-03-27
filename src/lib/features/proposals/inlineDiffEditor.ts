import { ChangeSet, simplifyChanges } from 'prosemirror-changeset';
import {
  defaultValueCtx,
  Editor,
  editorViewOptionsCtx,
  parserCtx,
  rootCtx
} from '@milkdown/kit/core';
import { gfm } from '@milkdown/kit/preset/gfm';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import {
  DOMSerializer,
  type Node as ProseMirrorNode,
  type Slice as ProseMirrorSlice
} from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { StepMap } from '@milkdown/kit/prose/transform';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const inlineDiffPluginKey = new PluginKey('proposal-inline-diff');

export interface InlineDiffEditorController {
  editor: Editor;
}

interface CreateInlineDiffEditorOptions {
  editorRoot: HTMLDivElement;
  currentMarkdown: string;
  proposedMarkdown: string;
  showRemovedContent?: boolean;
}

export async function createInlineDiffEditor({
  editorRoot,
  currentMarkdown,
  proposedMarkdown,
  showRemovedContent = true
}: CreateInlineDiffEditorOptions) {
  const editor = Editor.make();

  editor
    .config((ctx) => {
      ctx.set(rootCtx, editorRoot);
      ctx.set(defaultValueCtx, proposedMarkdown);
      ctx.set(editorViewOptionsCtx, {
        editable: () => false
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(createInlineDiffPlugin(currentMarkdown, showRemovedContent));

  await editor.create();

  return {
    editor
  } satisfies InlineDiffEditorController;
}

export async function destroyInlineDiffEditor(
  controller: InlineDiffEditorController | null
) {
  if (!controller) {
    return null;
  }

  await controller.editor.destroy();
  return null;
}

function createInlineDiffPlugin(currentMarkdown: string, showRemovedContent: boolean) {
  return $prose((ctx) => {
    let currentDoc: ProseMirrorNode | null = null;

    const getCurrentDoc = () => {
      if (currentDoc) {
        return currentDoc;
      }

      const parser = ctx.get(parserCtx);
      currentDoc = parser(currentMarkdown);
      return currentDoc;
    };

    return new Plugin({
      key: inlineDiffPluginKey,
      props: {
        decorations: (state) => {
          const baseDoc = getCurrentDoc();
          if (!baseDoc) {
            return DecorationSet.empty;
          }

          const decorations = buildInlineDiffDecorations(
            baseDoc,
            state.doc,
            showRemovedContent
          );

          return decorations.length === 0
            ? DecorationSet.empty
            : DecorationSet.create(state.doc, decorations);
        }
      }
    });
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
