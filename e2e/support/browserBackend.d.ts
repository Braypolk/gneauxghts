type BrowserE2EInvocation = {
  command: string;
  args: Record<string, unknown>;
};

type BrowserE2ENote = {
  noteId: string;
  title: string;
  markdown: string;
  path: string;
};

declare global {
  interface Window {
    __GNEAUXGHTS_E2E__?: {
      invocations: BrowserE2EInvocation[];
      holdSave(fail?: boolean): void;
      releaseSave(): void;
      seedRevisionChat(): void;
      seedLargeHistory(): void;
      delayNextHistoryPage(delayMillis?: number): void;
      snapshot(): {
        activeNoteId: string;
        notes: BrowserE2ENote[];
        invocations: BrowserE2EInvocation[];
      };
    };
  }
}

export {};
