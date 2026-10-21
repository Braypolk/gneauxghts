import { SvelteMap } from 'svelte/reactivity';
import { canForgetConversation, createPiConversationView, type PiConversationBinding, type PiViewSnapshot } from '#lib/features/chat/ui/piConversationView.js';
import type { ChatSurfaceHandle } from '#lib/features/chat/types.js';
import type { PaneKind } from '#lib/features/notepad/workspace/paneTypes.js';
import { paneHasCapability } from '#lib/features/notepad/workspace/paneCapabilities.js';

export interface NotepadChatCoordinatorDeps<TPaneId extends string> {
  getActivePaneId: () => TPaneId;
  getPaneKind: (paneId: TPaneId) => PaneKind;
  startNewNote: () => Promise<void>;
  forgetNote: () => Promise<void>;
  unforgetNote: () => Promise<void>;
}

/** Pane selection and mounted surfaces only. Pi owns conversation execution. */
export class NotepadChatCoordinator<TPaneId extends string> {
  private readonly bindings = new Map<TPaneId, PiConversationBinding>();
  private readonly surfaceHandles = new Map<TPaneId, ChatSurfaceHandle>();
  private readonly snapshots = new SvelteMap<TPaneId, PiViewSnapshot>();
  private readonly subscriptions = new Map<TPaneId, () => void>();
  constructor(initialPaneIds: TPaneId[], private readonly deps: NotepadChatCoordinatorDeps<TPaneId>) {
    for (const id of initialPaneIds) this.ensureBinding(id);
  }
  ensureBinding(id: TPaneId) {
    let binding = this.bindings.get(id);
    if (!binding) {
      binding = createPiConversationView(); this.bindings.set(id, binding);
      this.subscriptions.set(id, binding.subscribe(value => this.snapshots.set(id, value)));
    }
    return binding;
  }
  getBinding(id: TPaneId) { return this.ensureBinding(id); }
  setSurfaceHandle(id: TPaneId, handle: ChatSurfaceHandle | null) {
    if (handle) this.surfaceHandles.set(id, handle); else this.surfaceHandles.delete(id);
  }
  focusComposer(id: TPaneId) { return this.surfaceHandles.get(id)?.focusComposer() ?? false; }
  canUnforget(id: TPaneId) { const value = this.snapshots.get(id); return Boolean(value?.recentlyForgotten && !value.loading && !value.forgetting && value.runtimeState === 'open'); }
  canForget(id: TPaneId) { const value = this.snapshots.get(id); return value ? canForgetConversation(value) : false; }
  async startNewActiveItem() {
    const id = this.deps.getActivePaneId();
    if (paneHasCapability(this.deps.getPaneKind(id), 'host-chat')) await this.getBinding(id).startNew();
    else await this.deps.startNewNote();
  }
  async forgetActiveItem() {
    const id = this.deps.getActivePaneId();
    if (!paneHasCapability(this.deps.getPaneKind(id), 'host-chat')) return this.deps.forgetNote();
    const binding = this.getBinding(id);
    try { await binding.forget(); this.focusComposer(id); } catch (error) { binding.report(error); }
  }
  async unforgetActiveItem() {
    const id = this.deps.getActivePaneId();
    if (!paneHasCapability(this.deps.getPaneKind(id), 'host-chat')) return this.deps.unforgetNote();
    const binding = this.getBinding(id);
    try { await binding.unforget(); this.focusComposer(id); } catch (error) { binding.report(error); }
  }
  disposePane(id: TPaneId) { this.subscriptions.get(id)?.(); this.subscriptions.delete(id); this.snapshots.delete(id); this.bindings.get(id)?.dispose(); this.bindings.delete(id); this.surfaceHandles.delete(id); }
  dispose() { for (const id of this.bindings.keys()) this.disposePane(id); }
}
