import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  dropCursor,
  placeholder
} from '@codemirror/view';
import { search } from '@codemirror/search';
import type { ImagesConfig } from '$lib/features/notepad/images/imageConfig';
import { createImageEmbedsExtension } from '$lib/features/notepad/images/imageEmbeds';
import { createImagePasteExtension } from '$lib/features/notepad/images/imagePaste';
import { createWikilinksExtension } from '$lib/features/notepad/wikilinks/wikilinks';
import {
  createSlashMenuPlugin,
  type SlashMenuAPI
} from './slashMenu';
import { createSelectionMenuPlugin } from './selectionMenu';
import type {
  EditorController,
  EditorSelection,
  SharedEditorResources
} from './types';
import {
  createEditorShortcuts,
  createFilteredDefaultKeymap,
  createPlatformNavigationKeymap
} from './editorShortcuts';
import {
  createLayoutTheme,
  createOverlayScrollMargins
} from './editorTheme';
import { createPassiveTableExtension } from './passiveTableExtension';
import { createExternalLinkClickExtension } from './externalLinkExtension';
import { createExternalSearchHighlightExtension } from './searchHighlightExtension';
import { createBlockHandleExtension } from './blockHandleExtension';
import { createViewStateTrackingExtension } from './viewStateTrackingExtension';
import { createTaskDateExtension } from './taskDateExtension';
import { createCursorExtension } from './cursorExtension';
import { editorScrollExtension } from './editorScroll';

const unavailableImagesConfig: ImagesConfig = {
  assetRootPath: null,
  storePastedImage: async () => {
    throw new Error('Image pasting unavailable for this editor instance.');
  }
};

export function createPaneState(
  markdown: string,
  extensions: readonly Extension[],
  initialSelection: EditorSelection | null = null
) {
  return EditorState.create({
    doc: markdown,
    selection: initialSelection
      ? {
          anchor: Math.max(0, initialSelection.anchor),
          head: Math.max(0, initialSelection.head)
        }
      : undefined,
    extensions
  });
}

function createWikilinkExtensions(
  sharedResources: SharedEditorResources | null
) {
  return createWikilinksExtension({
    resolveCallbacks: (view) =>
      sharedResources?.resolveViewCallbacks(view) ?? null
  });
}

export interface PaneExtensionApis {
  extensions: Extension[];
  slashMenuApi: ReturnType<typeof createSlashMenuPlugin>;
  selectionMenuApi: ReturnType<typeof createSelectionMenuPlugin>;
}

export function createPaneExtensions(
  controller: () => EditorController | null,
  editorRoot: HTMLDivElement,
  sharedResources: SharedEditorResources | null
): PaneExtensionApis {
  const imagesConfig =
    sharedResources?.imagesConfig ?? unavailableImagesConfig;
  const slashMenuApi = createSlashMenuPlugin();
  const selectionMenuApi = createSelectionMenuPlugin();
  const extensions: Extension[] = [
    EditorView.contentAttributes.of({ spellcheck: 'true' }),
    search(),
    createExternalSearchHighlightExtension(),
    createLayoutTheme(),
    createCursorExtension(),
    createTaskDateExtension(),
    dropCursor(),
    createOverlayScrollMargins(editorRoot),
    editorScrollExtension,
    placeholder('Start typing here.'),
    createPassiveTableExtension(),
    ...createWikilinkExtensions(sharedResources),
    createExternalLinkClickExtension((view) => sharedResources?.resolveViewCallbacks(view) ?? null),
    createImageEmbedsExtension(imagesConfig, (view) => sharedResources?.resolveViewCallbacks(view) ?? null),
    ...createImagePasteExtension(imagesConfig),
    ...slashMenuApi.extension,
    ...selectionMenuApi.extension,
    createBlockHandleExtension(editorRoot, slashMenuApi.show),
    createViewStateTrackingExtension(sharedResources),
    createEditorShortcuts(controller),
    createPlatformNavigationKeymap(),
    EditorView.domEventHandlers({
      focus: (_event, view) => {
        slashMenuApi.register(view);
        selectionMenuApi.register(view);
        return false;
      }
    }),
    createFilteredDefaultKeymap()
  ];

  return {
    extensions,
    slashMenuApi,
    selectionMenuApi
  };
}

export type { SlashMenuAPI };
