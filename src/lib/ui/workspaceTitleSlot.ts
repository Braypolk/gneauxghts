/** Layout-only destination for the existing active pane title surface. */
export const workspaceTitleSlotKey = Symbol('workspace title slot');
export type WorkspaceTitleSlot = () => HTMLElement | null;
