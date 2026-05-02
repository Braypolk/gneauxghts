import type { Action } from 'svelte/action';

export interface EditorActionParams {
  /** Whether the editor should be mounted on this node. */
  shouldMount: boolean;
  /**
   * Mount the editor on the bound node. Called when the action observes
   * shouldMount=true and is currently unmounted.
   */
  mount: (node: HTMLDivElement) => Promise<void> | void;
  /**
   * Tear down the editor that this action mounted. Called when shouldMount
   * transitions from true → false, or when the action's host node is
   * destroyed.
   */
  destroy: () => Promise<void> | void;
}

/**
 * Svelte action that owns the CodeMirror editor lifecycle (mount + destroy)
 * for a single pane's editor root. The action defers the actual editor
 * create/destroy work to caller-supplied callbacks so the pane-aware
 * controller stays out of the action layer; this keeps the action a thin,
 * reusable lifecycle wrapper.
 *
 * Usage:
 *   <div use:editor={{ shouldMount, mount, destroy }} />
 *
 * Transitions:
 *   - On initial action attach with shouldMount=true: invoke mount(node).
 *   - shouldMount false → true: invoke mount(node).
 *   - shouldMount true → false: invoke destroy().
 *   - Host node destroyed while mounted: invoke destroy().
 *
 * Mount/destroy transitions are serialized so rapid toggles don't race.
 */
export const editor: Action<HTMLDivElement, EditorActionParams> = (node, params) => {
  let current: EditorActionParams = params;
  let mounted = false;
  let pending: Promise<void> = Promise.resolve();

  function transition(next: EditorActionParams) {
    pending = pending
      .then(async () => {
        if (next.shouldMount && !mounted) {
          await next.mount(node);
          mounted = true;
        } else if (!next.shouldMount && mounted) {
          await next.destroy();
          mounted = false;
        }
      })
      .catch((error) => {
        console.error('use:editor lifecycle transition failed:', error);
      });
  }

  transition(current);

  return {
    update(next: EditorActionParams) {
      current = next;
      transition(next);
    },
    destroy() {
      pending = pending.then(async () => {
        if (mounted) {
          await current.destroy();
          mounted = false;
        }
      });
    }
  };
};
