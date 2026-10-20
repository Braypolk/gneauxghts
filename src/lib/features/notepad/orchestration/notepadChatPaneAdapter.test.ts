import { describe, expect, it, vi } from 'vitest';
import { createNoteDraftState } from '$lib/features/notepad/state/noteStore';
import { createEmptySessionSnapshot } from '$lib/features/notepad/session/session';
import { createPiConversationView } from '$lib/features/chat/ui/piConversationView';
import { createNotepadChatPaneAdapter } from './notepadChatPaneAdapter';

describe('Pi chat pane integration', () => {
  it('retains the neighboring dirty note as an editor return route and exposes only explicit source navigation', async () => {
    const documents = { chat: createNoteDraftState(createEmptySessionSnapshot()), editor: createNoteDraftState({ ...createEmptySessionSnapshot(), title: 'Unsaved title', bodyMarkdown: 'Unsaved text' }) };
    const binding = createPiConversationView(), openSource = vi.fn(async () => {}), setConversation = vi.fn(), touch = vi.fn(), surface = vi.fn();
    const adapter = createNotepadChatPaneAdapter<'chat' | 'editor'>({ coordinator: { getBinding: () => binding, setSurfaceHandle: surface },
      getPaneOrder: () => ['chat', 'editor'], getPaneKind: id => id === 'chat' ? 'chat' : 'editor', getPaneDocument: id => documents[id],
      setPaneDocument: (id, document) => documents[id] = document, getPaneConversationId: () => null, setPaneConversationId: setConversation, touchPaneLocation: touch, openSource });
    try {
      adapter.syncRetainedContexts(); expect(documents.chat).toBe(documents.editor); expect(documents.editor.working.body.toMarkdown()).toBe('Unsaved text');
      const exposed = adapter.getBindings('chat'); expect(Object.keys(exposed.context)).toEqual(['onOpenSource']);
      exposed.session.onConversationChange('42'); expect(setConversation).toHaveBeenCalledWith('chat', '42'); expect(touch).toHaveBeenCalledWith('chat');
      await exposed.context.onOpenSource('native-authority', 'native-source'); expect(openSource).toHaveBeenCalledWith('chat', 'native-authority', 'native-source');
    } finally { binding.dispose(); }
  });
});
