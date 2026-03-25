import { editorViewCtx } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import {
  applyBlockTypeSelection,
  blockTypeIcons,
  blockTypeMenuGroups,
  type EditorMenuOption
} from '$lib/features/notepad/editor/blockTypes';
import type { CursorPosition } from '$lib/features/notepad/editor/cursorState';
import type { EditorController } from '$lib/features/notepad/editor/editor';

interface BlockContext {
  targetPos: number;
  currentTypeId: string | null;
}

function getBlockHandleDragButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;

  const operationItem = target.closest('.operation-item');
  const blockHandle = operationItem?.closest('.milkdown-block-handle');

  if (!(operationItem instanceof HTMLElement) || !(blockHandle instanceof HTMLElement)) return null;

  return operationItem === blockHandle.lastElementChild ? operationItem : null;
}

function resolveBlockContext(
  controller: EditorController,
  editorRoot: HTMLDivElement,
  handleButton: HTMLElement
): BlockContext | null {
  const rect = handleButton.getBoundingClientRect();
  const probeY = Math.round(
    Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2))
  );

  let hitElement: HTMLElement | null = null;
  for (const offset of [32, 64, 96, 128]) {
    const probeX = Math.round(Math.min(window.innerWidth - 1, Math.max(0, rect.right + offset)));
    const candidate = document.elementFromPoint(probeX, probeY);
    if (candidate instanceof HTMLElement && editorRoot.contains(candidate)) {
      hitElement = candidate;
      break;
    }
  }

  if (!hitElement) return null;

  let result: BlockContext | null = null;
  controller.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    try {
      const pos = view.posAtDOM(hitElement!, 0);
      const $pos = view.state.doc.resolve(pos);

      for (let depth = $pos.depth; depth >= 1; depth -= 1) {
        const node = $pos.node(depth);
        const name = node.type.name;

        if (name === 'heading') {
          result = { targetPos: $pos.end(depth), currentTypeId: `heading${node.attrs.level}` };
          return;
        }
        if (name === 'code_block') {
          result = { targetPos: $pos.start(depth) + 1, currentTypeId: 'code' };
          return;
        }
        if (name === 'blockquote') {
          const innerPos = $pos.parent.isTextblock ? $pos.end() : $pos.start(depth) + 1;
          result = { targetPos: innerPos, currentTypeId: 'quote' };
          return;
        }
        if (name === 'list_item') {
          const innerPos = $pos.parent.isTextblock ? $pos.end() : $pos.start(depth) + 1;
          if (depth >= 2) {
            const listNode = $pos.node(depth - 1);
            if (listNode.type.name === 'ordered_list') {
              result = { targetPos: innerPos, currentTypeId: 'orderedList' };
              return;
            }
            if (node.attrs.checked != null) {
              result = { targetPos: innerPos, currentTypeId: 'taskList' };
              return;
            }
            result = { targetPos: innerPos, currentTypeId: 'bulletList' };
            return;
          }
        }
        if (name === 'paragraph') {
          result = { targetPos: $pos.end(depth), currentTypeId: 'paragraph' };
          return;
        }
      }

      if ($pos.parent.isTextblock) {
        result = { targetPos: $pos.end(), currentTypeId: null };
      }
    } catch {
      result = null;
    }
  });

  return result;
}

function applyBlockTypeMenuSelection(
  controller: EditorController,
  targetPos: number,
  option: EditorMenuOption,
  preservedSelection: CursorPosition | null = null
) {
  controller.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const maxPos = Math.max(1, view.state.doc.nodeSize - 2);
    const selectionPos = Math.max(1, Math.min(targetPos, maxPos));
    const nextAnchor = preservedSelection
      ? Math.max(1, Math.min(preservedSelection.anchor, maxPos))
      : selectionPos;
    const nextHead = preservedSelection
      ? Math.max(1, Math.min(preservedSelection.head, maxPos))
      : selectionPos;
    const transaction = view.state.tr
      .setSelection(TextSelection.create(view.state.doc, nextAnchor, nextHead))
      .scrollIntoView();

    view.dispatch(transaction);
    view.focus();
    applyBlockTypeSelection(ctx, view, option.id);
  });
}

function getTextblockRangeAtPos(doc: ProseMirrorNode, pos: number) {
  const maxPos = Math.max(1, doc.nodeSize - 2);
  const $pos = doc.resolve(Math.max(1, Math.min(pos, maxPos)));

  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (node.isTextblock) {
      return {
        from: $pos.start(depth),
        to: $pos.end(depth)
      };
    }
  }

  return {
    from: $pos.pos,
    to: $pos.pos
  };
}

function selectionTouchesBlock(doc: ProseMirrorNode, selection: CursorPosition, pos: number) {
  const start = Math.min(selection.anchor, selection.head);
  const end = Math.max(selection.anchor, selection.head);
  const blockRange = getTextblockRangeAtPos(doc, pos);
  return end >= blockRange.from && start <= blockRange.to;
}

function positionBlockTypeMenu(menuRoot: HTMLDivElement, anchorRect: DOMRect) {
  menuRoot.dataset.open = 'true';
  menuRoot.style.visibility = 'hidden';
  menuRoot.style.left = '0px';
  menuRoot.style.top = '0px';

  requestAnimationFrame(() => {
    if (menuRoot.dataset.open !== 'true') return;

    const viewportPadding = 12;
    const menuRect = menuRoot.getBoundingClientRect();
    const nextLeft = Math.min(
      window.innerWidth - menuRect.width - viewportPadding,
      Math.max(viewportPadding, anchorRect.right + 12)
    );
    const nextTop = Math.min(
      window.innerHeight - menuRect.height - viewportPadding,
      Math.max(viewportPadding, anchorRect.top + anchorRect.height / 2 - menuRect.height / 2)
    );

    menuRoot.style.left = `${Math.round(nextLeft)}px`;
    menuRoot.style.top = `${Math.round(nextTop)}px`;
    menuRoot.style.visibility = 'visible';
  });
}

export function setupBlockHandleTypeMenu(
  controller: EditorController,
  editorRoot: HTMLDivElement
) {
  const documentRoot = editorRoot.ownerDocument;
  const menuRoot = documentRoot.createElement('div');
  menuRoot.className = 'notepad-block-type-menu';
  menuRoot.dataset.open = 'false';

  const buttonsById = new Map<string, HTMLButtonElement>();
  let activeTargetPos: number | null = null;
  let activeSelection: CursorPosition | null = null;

  const closeMenu = () => {
    activeTargetPos = null;
    activeSelection = null;
    menuRoot.dataset.open = 'false';
    menuRoot.style.removeProperty('left');
    menuRoot.style.removeProperty('top');
    menuRoot.style.removeProperty('visibility');
  };

  const tabNav = documentRoot.createElement('nav');
  tabNav.className = 'notepad-block-type-menu-tabs';
  const tabList = documentRoot.createElement('ul');
  const tabsByKey = new Map<string, HTMLLIElement>();

  const selectTab = (key: string) => {
    for (const [candidateKey, tab] of tabsByKey) {
      tab.classList.toggle('selected', candidateKey === key);
    }
    const targetGroup = menuGroups.querySelector(`[data-group="${key}"]`);
    if (targetGroup) {
      targetGroup.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  for (const group of blockTypeMenuGroups) {
    const tab = documentRoot.createElement('li');
    tab.textContent = group.label;
    tab.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      selectTab(group.key);
    });
    tabsByKey.set(group.key, tab);
    tabList.appendChild(tab);
  }

  tabNav.appendChild(tabList);
  menuRoot.appendChild(tabNav);

  const menuGroups = documentRoot.createElement('div');
  menuGroups.className = 'notepad-block-type-menu-groups';
  const groupElementsByKey = new Map<string, HTMLDivElement>();

  for (const group of blockTypeMenuGroups) {
    const groupElement = documentRoot.createElement('div');
    groupElement.className = 'notepad-block-type-menu-group';
    groupElement.dataset.group = group.key;

    const heading = documentRoot.createElement('h6');
    heading.textContent = group.label;
    groupElement.appendChild(heading);

    for (const option of group.items) {
      const button = documentRoot.createElement('button');
      button.type = 'button';
      button.className = 'notepad-block-type-menu-item';
      button.dataset.option = option.id;
      button.innerHTML = `${blockTypeIcons[option.id] ?? ''}<span>${option.label}</span>`;
      button.addEventListener('click', () => {
        if (activeTargetPos === null) return;
        applyBlockTypeMenuSelection(controller, activeTargetPos, option, activeSelection);
        closeMenu();
      });

      buttonsById.set(option.id, button);
      groupElement.appendChild(button);
    }

    groupElementsByKey.set(group.key, groupElement);
    menuGroups.appendChild(groupElement);
  }

  const updateActiveTab = () => {
    const scrollTop = menuGroups.scrollTop;
    let activeKey = blockTypeMenuGroups[0]?.key;
    for (const [key, element] of groupElementsByKey) {
      if (element.offsetTop - menuGroups.offsetTop <= scrollTop + 8) {
        activeKey = key;
      }
    }
    if (activeKey) {
      for (const [key, tab] of tabsByKey) {
        tab.classList.toggle('selected', key === activeKey);
      }
    }
  };
  menuGroups.addEventListener('scroll', updateActiveTab);

  menuRoot.appendChild(menuGroups);
  documentRoot.body.appendChild(menuRoot);

  let pointerState: {
    pointerId: number;
    startX: number;
    startY: number;
    handleButton: HTMLElement;
    moved: boolean;
    selection: CursorPosition | null;
  } | null = null;

  const onTrackedPointerDown = (event: PointerEvent) => {
    const handleButton = getBlockHandleDragButton(event.target);
    if (!handleButton) return;

    controller.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { selection } = view.state;
      const preservedSelection = !selection.empty
        ? {
            anchor: selection.anchor,
            head: selection.head
          }
        : null;

      pointerState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        handleButton,
        moved: false,
        selection: preservedSelection
      };
    });

    event.preventDefault();
  };

  const onWindowPointerMove = (event: PointerEvent) => {
    if (!pointerState || event.pointerId !== pointerState.pointerId) return;

    if (Math.hypot(event.clientX - pointerState.startX, event.clientY - pointerState.startY) > 6) {
      pointerState.moved = true;
    }
  };

  const onWindowPointerUp = (event: PointerEvent) => {
    if (!pointerState || event.pointerId !== pointerState.pointerId) return;

    const captured = pointerState;
    pointerState = null;

    if (captured.moved || !captured.handleButton.isConnected) return;

    event.preventDefault();
    event.stopPropagation();

    const context = resolveBlockContext(controller, editorRoot, captured.handleButton);
    if (!context) {
      closeMenu();
      return;
    }

    activeTargetPos = context.targetPos;
    if (captured.selection) {
      controller.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        activeSelection = selectionTouchesBlock(view.state.doc, captured.selection!, context.targetPos)
          ? captured.selection
          : null;
      });
    } else {
      activeSelection = null;
    }

    let activeGroupKey = blockTypeMenuGroups[0]?.key;
    for (const [optionId, button] of buttonsById) {
      const isActive = context.currentTypeId === optionId;
      button.dataset.active = isActive ? 'true' : 'false';
      if (isActive) {
        for (const group of blockTypeMenuGroups) {
          if (group.items.some((item) => item.id === optionId)) {
            activeGroupKey = group.key;
            break;
          }
        }
      }
    }

    for (const [key, tab] of tabsByKey) {
      tab.classList.toggle('selected', key === activeGroupKey);
    }
    menuGroups.scrollTop = 0;
    positionBlockTypeMenu(menuRoot, captured.handleButton.getBoundingClientRect());
  };

  const onWindowPointerCancel = (event: PointerEvent) => {
    if (pointerState && event.pointerId === pointerState.pointerId) {
      pointerState = null;
    }
  };

  const onDocumentPointerDown = (event: PointerEvent) => {
    if (menuRoot.dataset.open !== 'true') return;

    const target = event.target;
    if (!(target instanceof Node)) {
      closeMenu();
      return;
    }

    if (menuRoot.contains(target) || getBlockHandleDragButton(target)) return;
    closeMenu();
  };

  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (menuRoot.dataset.open === 'true' && event.key === 'Escape') {
      closeMenu();
    }
  };

  const onWindowResize = () => {
    if (menuRoot.dataset.open === 'true') closeMenu();
  };

  editorRoot.addEventListener('pointerdown', onTrackedPointerDown, true);
  window.addEventListener('pointermove', onWindowPointerMove, true);
  window.addEventListener('pointerup', onWindowPointerUp, true);
  window.addEventListener('pointercancel', onWindowPointerCancel, true);
  documentRoot.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('keydown', onWindowKeyDown, true);
  window.addEventListener('resize', onWindowResize);

  return () => {
    closeMenu();
    editorRoot.removeEventListener('pointerdown', onTrackedPointerDown, true);
    window.removeEventListener('pointermove', onWindowPointerMove, true);
    window.removeEventListener('pointerup', onWindowPointerUp, true);
    window.removeEventListener('pointercancel', onWindowPointerCancel, true);
    documentRoot.removeEventListener('pointerdown', onDocumentPointerDown, true);
    window.removeEventListener('keydown', onWindowKeyDown, true);
    window.removeEventListener('resize', onWindowResize);
    menuRoot.remove();
  };
}
