import { createContext } from 'svelte';

/** Layout-only destination for the existing active pane title surface. */
export type WorkspaceTitleSlot = () => HTMLElement | null;
export const [getWorkspaceTitleSlot, setWorkspaceTitleSlot, hasWorkspaceTitleSlot] =
  createContext<WorkspaceTitleSlot>();
