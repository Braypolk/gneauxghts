import type { PiConversationBinding } from '$lib/features/chat/ui/piConversationView';
import type { ChatSurfaceHandle } from '$lib/features/chat/types';

export interface ChatPaneBindings {
  session: {
    binding: PiConversationBinding;
    conversationId: string | null;
    draftSlot: string;
    onConversationChange: (id: string | null) => void;
    onSurfaceHandleChange: (handle: ChatSurfaceHandle | null) => void;
  };
  // Successful navigation may return informational feedback; failures reject.
  context: { onOpenSource: (authorityId: string, sourceId: string) => Promise<string | void> };
}
