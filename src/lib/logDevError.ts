export function logDevError(message: string, error?: unknown): void {
  if (!import.meta.env.DEV) {
    return;
  }

  if (error !== undefined) {
    console.error(message, error);
  } else {
    console.error(message);
  }
}
