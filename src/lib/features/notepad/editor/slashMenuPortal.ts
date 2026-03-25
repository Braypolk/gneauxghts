interface SlashMenuPortalControllerOptions {
  boundsElement: HTMLElement;
  editorRoot: HTMLElement;
  portalRoot: HTMLElement;
}

export function setupSlashMenuPortal({
  boundsElement,
  editorRoot,
  portalRoot
}: SlashMenuPortalControllerOptions) {
  let frame: number | null = null;

  function portalSlashMenu() {
    const slashMenu = editorRoot.querySelector('.milkdown-slash-menu');
    if (!(slashMenu instanceof HTMLElement)) return;
    if (slashMenu.parentElement === portalRoot) return;

    portalRoot.appendChild(slashMenu);
  }

  function getPortaledSlashMenuElements() {
    const slashMenu = portalRoot.querySelector('.milkdown-slash-menu');
    const menuGroups = slashMenu?.querySelector('.menu-groups');

    if (!(slashMenu instanceof HTMLElement) || !(menuGroups instanceof HTMLElement)) {
      return null;
    }

    return { slashMenu, menuGroups };
  }

  function clampPortaledSlashMenu() {
    const elements = getPortaledSlashMenuElements();
    if (!elements) return;

    const { slashMenu, menuGroups } = elements;
    if (slashMenu.dataset.show !== 'true') {
      slashMenu.style.removeProperty('--notepad-slash-menu-max-height');
      return;
    }

    const viewportPadding = 16;
    const boundsRect = boundsElement.getBoundingClientRect();
    const minTop = Math.max(viewportPadding, boundsRect.top + viewportPadding);
    const maxBottom = Math.min(window.innerHeight - viewportPadding, boundsRect.bottom - viewportPadding);
    const initialRect = slashMenu.getBoundingClientRect();
    const menuGroupsRect = menuGroups.getBoundingClientRect();
    const chromeHeight = Math.max(0, initialRect.height - menuGroupsRect.height);
    const nextMaxHeight = Math.max(0, Math.floor(maxBottom - minTop - chromeHeight));

    slashMenu.style.setProperty('--notepad-slash-menu-max-height', `${nextMaxHeight}px`);

    const clampedRect = slashMenu.getBoundingClientRect();
    const currentTop = Number.parseFloat(slashMenu.style.top || '0');
    let nextTop = currentTop;

    if (clampedRect.top < minTop) {
      nextTop += minTop - clampedRect.top;
    }

    if (clampedRect.bottom > maxBottom) {
      nextTop -= clampedRect.bottom - maxBottom;
    }

    if (Number.isFinite(nextTop) && nextTop !== currentTop) {
      slashMenu.style.top = `${Math.round(nextTop)}px`;
    }
  }

  function scheduleClamp() {
    if (frame !== null) return;

    frame = window.requestAnimationFrame(() => {
      frame = null;
      portalSlashMenu();
      clampPortaledSlashMenu();
    });
  }

  const sourceObserver = new MutationObserver(() => {
    scheduleClamp();
  });

  sourceObserver.observe(editorRoot, {
    childList: true,
    subtree: true
  });

  const portalObserver = new MutationObserver(() => {
    scheduleClamp();
  });

  portalObserver.observe(portalRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-show', 'style']
  });

  const handleResize = () => {
    scheduleClamp();
  };

  window.addEventListener('resize', handleResize);
  scheduleClamp();

  return () => {
    sourceObserver.disconnect();
    portalObserver.disconnect();
    window.removeEventListener('resize', handleResize);
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
  };
}
