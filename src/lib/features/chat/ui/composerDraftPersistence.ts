import { logDevError } from '$lib/logDevError';

export const COMPOSER_DRAFT_SAVE_DELAY_MS = 400;

export interface ComposerDraftPersistenceDeps {
  getDraft: (slot: string) => Promise<string>;
  setDraft: (slot: string, body: string) => Promise<void>;
  /** Puts a loaded draft back into the composer. */
  applyDraft: (body: string) => void;
  saveDelayMs?: number;
}

/**
 * Synchronous mirror of the latest known draft per slot. Writes to the vault
 * are async; without this, remounting the composer after a pane switch can
 * reload a stale empty value before the flush lands.
 */
const draftCache = new Map<string, string>();

/** Test helper — clears the process-wide draft mirror. */
export function resetComposerDraftCacheForTests() {
  draftCache.clear();
}

/**
 * Keeps unsent composer text alive across conversation switches and restarts.
 *
 * A "slot" is whatever the composer is currently writing into: a conversation,
 * or the pane itself while the conversation has not been created yet. Each slot
 * keeps its own unsent text, so switching away and back is non-destructive.
 */
export function createComposerDraftPersistence(deps: ComposerDraftPersistenceDeps) {
  const saveDelayMs = deps.saveDelayMs ?? COMPOSER_DRAFT_SAVE_DELAY_MS;

  let slot: string | null = null;
  let pendingBody: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let loadToken = 0;
  /** True while an openSlot load is in flight. */
  let loadInFlight = false;

  function cancelPendingSave() {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  function write(targetSlot: string, body: string) {
    draftCache.set(targetSlot, body);
    void deps.setDraft(targetSlot, body).catch((error) => {
      logDevError('Failed to persist chat composer draft', error);
    });
  }

  function flush() {
    cancelPendingSave();
    if (slot === null || pendingBody === null) return;
    const body = pendingBody;
    pendingBody = null;
    write(slot, body);
  }

  return {
    /**
     * Points the composer at a slot and restores its unsent text. Any pending
     * write for the previous slot is flushed first so nothing is lost.
     */
    async openSlot(nextSlot: string) {
      if (nextSlot === slot) return;
      flush();
      slot = nextSlot;
      pendingBody = null;
      const token = ++loadToken;
      loadInFlight = true;

      let body = '';
      try {
        if (draftCache.has(nextSlot)) {
          body = draftCache.get(nextSlot) ?? '';
        } else {
          body = await deps.getDraft(nextSlot);
          // Only cache if another writer did not beat us to it.
          if (!draftCache.has(nextSlot)) {
            draftCache.set(nextSlot, body);
          } else {
            body = draftCache.get(nextSlot) ?? body;
          }
        }
      } catch (error) {
        logDevError('Failed to load chat composer draft', error);
        if (token === loadToken) loadInFlight = false;
        return;
      }

      // Bail out if the slot moved on, or the user started typing while the
      // stored draft was still loading — their keystrokes win.
      if (token !== loadToken || pendingBody !== null) {
        if (token === loadToken) loadInFlight = false;
        return;
      }
      deps.applyDraft(body);
      if (token === loadToken) loadInFlight = false;
    },

    /**
     * Declares the composer empty and on `nextSlot`, clearing stored text for
     * both the outgoing and incoming slots. Used when the user explicitly
     * starts over and when a draft graduates into a real conversation.
     */
    resetSlot(nextSlot: string) {
      cancelPendingSave();
      pendingBody = null;
      loadToken += 1;
      loadInFlight = false;
      const previousSlot = slot;
      slot = nextSlot;
      if (previousSlot !== null && previousSlot !== nextSlot) {
        write(previousSlot, '');
      }
      write(nextSlot, '');
    },

    /** Records live composer text, debounced. */
    record(body: string) {
      if (slot === null) return;
      // The composer clears `draft` to '' before openSlot finishes loading.
      // That reactive wipe must not stamp pendingBody and cancel the restore.
      if (loadInFlight && body === '') return;
      pendingBody = body;
      cancelPendingSave();
      saveTimer = setTimeout(() => {
        saveTimer = null;
        flush();
      }, saveDelayMs);
    },

    /** Writes any pending text immediately. */
    flush,

    dispose() {
      flush();
      loadToken += 1;
      loadInFlight = false;
      slot = null;
    },

    /** Test/diagnostic read of the current slot. */
    peekSlot() {
      return slot;
    }
  };
}

export type ComposerDraftPersistence = ReturnType<
  typeof createComposerDraftPersistence
>;
