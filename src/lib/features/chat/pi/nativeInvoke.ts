import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { observePiNativeInvoke } from '$lib/e2e/piNativeInvokeProbe';

/** Production calls Tauri directly; only explicit native acceptance builds observe this boundary. */
export const invoke: typeof nativeInvoke = import.meta.env.VITE_E2E_NATIVE === 'true'
  ? (command, args, options) => observePiNativeInvoke(nativeInvoke, command, args, options)
  : nativeInvoke;
