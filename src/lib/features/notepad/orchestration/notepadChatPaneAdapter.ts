import type { ChatPaneBindings } from '$lib/features/notepad/pane/chatPaneBindings';
import type { NoteDraftState } from '$lib/features/notepad/state/noteStore';
import { getChatContextPaneId } from '$lib/features/notepad/workspace/paneRoles';
import type { PaneKind } from '$lib/features/notepad/workspace/paneTypes';
import { paneHasCapability } from '$lib/features/notepad/workspace/paneCapabilities';
import type { NotepadChatCoordinator } from './notepadChatCoordinator.svelte';

export interface NotepadChatPaneAdapterDeps<TPaneId extends string> {
  coordinator: Pick<NotepadChatCoordinator<TPaneId>, 'getBinding' | 'setSurfaceHandle'>;
  getPaneOrder: () => TPaneId[];
  getPaneKind: (paneId: TPaneId) => PaneKind;
  getPaneDocument: (paneId: TPaneId) => NoteDraftState;
  setPaneDocument: (paneId: TPaneId, document: NoteDraftState) => void;
  getPaneConversationId: (paneId: TPaneId) => string | null;
  setPaneConversationId: (paneId: TPaneId, id: string | null) => void;
  touchPaneLocation: (paneId: TPaneId) => void;
  openSource: (paneId: TPaneId, authorityId: string, sourceId: string) => Promise<string | void>;
}

/** Retained note route and source navigation; no editor content enters model input. */
export function createNotepadChatPaneAdapter<TPaneId extends string>(deps: NotepadChatPaneAdapterDeps<TPaneId>) {
  function syncRetainedContexts() {
    for (const id of deps.getPaneOrder()) {
      if (!paneHasCapability(deps.getPaneKind(id), 'host-chat')) continue;
      const contextId = getChatContextPaneId(deps.getPaneOrder(), deps.getPaneKind, id);
      if (contextId !== id) {
        const document = deps.getPaneDocument(contextId);
        if (document.handle !== deps.getPaneDocument(id).handle) deps.setPaneDocument(id, document);
      }
    }
  }
  function getBindings(id: TPaneId): ChatPaneBindings {
    return {
      session: {
        binding: deps.coordinator.getBinding(id), conversationId: deps.getPaneConversationId(id), draftSlot: `pane:${id}`,
        onConversationChange(conversationId) { deps.setPaneConversationId(id, conversationId); if (paneHasCapability(deps.getPaneKind(id), 'host-chat')) deps.touchPaneLocation(id); },
        onSurfaceHandleChange(handle) { deps.coordinator.setSurfaceHandle(id, handle); }
      },
      context: { onOpenSource: (authorityId, sourceId) => deps.openSource(id, authorityId, sourceId) }
    };
  }
  return { getBindings, syncRetainedContexts };
}
