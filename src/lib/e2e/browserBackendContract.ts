export type NoteFixture = {
  updatedAtMillis?: number;
  tags?: string[];
  noteId: string;
  title: string;
  markdown: string;
  path: string;
};

export type InvokeRecord = { command: string; args: Record<string, unknown> };
export type TauriCallback = (payload: unknown) => void;

export type BrowserCommandOverrides = Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>;

declare global {
  interface Window {
    __GNEAUXGHTS_E2E_COMMANDS__?: BrowserCommandOverrides;
    __GNEAUXGHTS_E2E__?: {
      invocations: InvokeRecord[];
      /** Reattach this fixture after the WDIO service installs its own interceptor. */
      restoreIpc(): void;
      setRelatedResponse(response: import('../types/semantic').RelatedNotesResponse | null, delayMillis?: number): void;
      setAtlas(response: import('../types/atlas').VaultAtlasResponse): void;
      holdSave(fail?: boolean): void;
      releaseSave(): void;
      seedImageAsset(name: string): void;
      configureImageSave(failures?: number, delayMillis?: number): void;
      seedPiChat(options?: { title?: string; count?: number; revisionSource?: boolean; toolCalls?: number }): Promise<string>;
      readPiChat(): Promise<Array<{ id: string; title: string; messages: Array<{ role: string; content: string }> }>>;
      holdNextPiResponse(): Promise<void>;
      setNextPiResponse(text: string, reasoning?: string): Promise<void>;
      emit(event: string, payload: unknown): void;
      holdHistoryRestore(): void;
      releaseHistoryRestore(): void;
      delayNextHistoryPage(delayMillis?: number): void;
      snapshot(): {
        activeNoteId: string | null;
        notes: NoteFixture[];
        invocations: InvokeRecord[];
      };
    };
  }
}
