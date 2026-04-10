type PendingNoteSaveHandler = () => Promise<void>;

let pendingNoteSaveHandler: PendingNoteSaveHandler | null = null;

export function registerPendingNoteSaveHandler(handler: PendingNoteSaveHandler) {
  pendingNoteSaveHandler = handler;

  return () => {
    if (pendingNoteSaveHandler === handler) {
      pendingNoteSaveHandler = null;
    }
  };
}

export async function awaitPendingNoteSave() {
  if (!pendingNoteSaveHandler) {
    return;
  }

  await pendingNoteSaveHandler();
}
