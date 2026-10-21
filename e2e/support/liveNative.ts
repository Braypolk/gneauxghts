import { browser } from '@wdio/globals';

export async function invokeNative<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await browser.execute((command: string, args: Record<string, unknown>) => new Promise<{
    ok: boolean;
    value?: unknown;
    error?: string;
  }>((done) => {
    const native = (window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
      };
    }).__TAURI_INTERNALS__;
    if (!native)
      return done({ ok: false, error: 'Real native IPC is required' });
    void native.invoke(command, args).then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }));
  }), command, args);
  if (!result.ok) throw new Error(`${command}: ${result.error}`);
  return result.value as T;
}
