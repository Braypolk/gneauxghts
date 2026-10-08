/** Move an existing surface into a layout slot without recreating its owner. */
export function mountInSlot(node: HTMLElement, target: HTMLElement | null | undefined) {
  const anchor = document.createComment('surface slot');
  node.before(anchor);

  function place(next: HTMLElement | null | undefined) {
    if (next) {
      if (node.parentElement !== next) next.append(node);
    } else if (anchor.parentNode && node.previousSibling !== anchor) {
      anchor.after(node);
    }
  }

  place(target);
  return {
    update: place,
    destroy() {
      node.remove();
      anchor.remove();
    }
  };
}
