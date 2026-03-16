import type { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { tick } from 'svelte';
import { notepadWikilinks, type ActiveWikilink } from './notepadWikilinks';
import { setupNotepadSlashMenuPortal } from './notepadSlashMenuPortal';

interface CreateNotepadEditorOptions {
  editorRoot: HTMLDivElement;
  initialValue: string;
  onOpenLink: (rawTarget: string) => void;
  onActiveWikilinkChange: (activeWikilink: ActiveWikilink | null) => void;
  onMarkdownChange: (markdown: string) => void;
}

interface ResetSlashMenuPortalOptions {
  boundsElement: HTMLDivElement | null;
  editorRoot: HTMLDivElement | null;
  portalRoot: HTMLDivElement | null;
  currentCleanup: (() => void) | null;
}

const wikilinkSlashIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M10 9H6.75A3.75 3.75 0 1 0 6.75 16.5H10" />
    <path d="M14 15H17.25A3.75 3.75 0 1 0 17.25 7.5H14" />
    <path d="M8.5 12h7" />
  </svg>
`;

export async function prepareNotepadEditor(editorRoot: HTMLDivElement | null) {
  if (!editorRoot) return false;
  await tick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return !!editorRoot;
}

export async function createNotepadEditor({
  editorRoot,
  initialValue,
  onOpenLink,
  onActiveWikilinkChange,
  onMarkdownChange
}: CreateNotepadEditorOptions) {
  const { Crepe } = await import('@milkdown/crepe');

  const crepe = new Crepe({
    root: editorRoot,
    defaultValue: initialValue,
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: 'Start writing',
        mode: 'doc'
      },
      [Crepe.Feature.BlockEdit]: {
        buildMenu: (builder) => {
          builder.getGroup('text').addItem('wikilink', {
            label: 'Wikilink',
            icon: wikilinkSlashIcon,
            onRun: (ctx) => {
              const view = ctx.get(editorViewCtx);
              const selectionFrom = view.state.selection.$from;
              const from = selectionFrom.start();
              const to = selectionFrom.end();
              const transaction = view.state.tr.insertText('[[]]', from, to);
              transaction.setSelection(TextSelection.create(transaction.doc, from + 2));
              view.dispatch(transaction);
              view.focus();
            }
          });
        }
      }
    }
  });

  crepe.addFeature(notepadWikilinks, {
    onOpenLink,
    onActiveWikilinkChange
  });

  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      onMarkdownChange(markdown);
    });
  });

  await crepe.create();
  return crepe;
}

export async function destroyNotepadEditor(crepe: Crepe | null) {
  if (!crepe) return null;
  await crepe.destroy();
  return null;
}

export function resetNotepadSlashMenuPortal({
  boundsElement,
  editorRoot,
  portalRoot,
  currentCleanup
}: ResetSlashMenuPortalOptions) {
  if (currentCleanup) {
    currentCleanup();
  }

  if (!boundsElement || !editorRoot || !portalRoot) {
    return null;
  }

  // Crepe mounts the slash menu inside the clipped editor tree, so we reparent and clamp it here.
  return setupNotepadSlashMenuPortal({
    boundsElement,
    editorRoot,
    portalRoot
  });
}

export function insertWikilinkSuggestion(
  crepe: Crepe | null,
  activeWikilink: ActiveWikilink | null,
  suggestionValue: string
) {
  if (!crepe || !activeWikilink) {
    return false;
  }

  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const transaction = view.state.tr.insertText(
      suggestionValue,
      activeWikilink.targetFrom,
      activeWikilink.targetTo
    );
    const cursorPosition = activeWikilink.targetFrom + suggestionValue.length;
    transaction.setSelection(TextSelection.create(transaction.doc, cursorPosition));
    view.dispatch(transaction);
    view.focus();
  });

  return true;
}
