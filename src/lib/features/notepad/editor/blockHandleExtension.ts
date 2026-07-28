import { isolateHistory } from '@codemirror/commands';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  describeBlockAt,
  insertParagraphBelow,
  listBlocks,
  moveBlockTo,
  type BlockDescriptor
} from './blockTypes';
import { getEditorContentSurface } from './editorDom';
import { mountBlockHandle } from './blockHandleMount';
import { setSlashMenuFloatingReference } from './slashMenu';

interface VisualLineAnchor {
  block: BlockDescriptor;
  docTop: number;
  docBottom: number;
  centerDocY: number;
}

interface HandleLaneMetrics {
  rootTop: number;
  left: number;
  textLeft: number;
  paddingLeft: number;
  surfaceWidth: number;
  handleHeight: number;
}

interface DropSlot {
  target: BlockDescriptor;
  before: boolean;
  indicatorDocY: number;
}

/** Resolve a CSS length, including rem/calc/custom properties, to pixels. */
export function resolveCssLength(host: Element, value: string): number {
  if (!value) {
    return 0;
  }

  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;height:0;width:' +
    value;
  host.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

export function createBlockHandleExtension(
  editorRoot: HTMLDivElement,
  showSlashMenu: (view: EditorView, pos: number) => void
) {
  return ViewPlugin.fromClass(
    class {
      readonly #view: EditorView;
      readonly #editorRoot: HTMLDivElement;
      readonly #scrollRoot: HTMLElement | null;
      readonly #dropIndicator: HTMLDivElement;
      readonly #unmountBlockHandle: () => void;
      #destroyed = false;
      #measureQueued = false;
      #hoveringHandle = false;
      #content: HTMLDivElement | null = null;
      #addButton: HTMLButtonElement | null = null;
      #dragButton: HTMLButtonElement | null = null;
      #currentBlock: BlockDescriptor | null = null;
      #pendingAnchor: VisualLineAnchor | null = null;
      #laneMetrics: HandleLaneMetrics | null = null;
      #laneDirty = true;
      #dropSlots: DropSlot[] | null = null;
      #dropSlotsDirty = true;
      #pointerX = 0;
      #pointerY = 0;
      #drag:
        | {
            pointerId: number;
            startX: number;
            startY: number;
            source: BlockDescriptor;
            before: boolean;
            target: BlockDescriptor | null;
            dragging: boolean;
            indicatorDocY: number | null;
          }
        | null = null;

      constructor(view: EditorView) {
        this.#view = view;
        this.#editorRoot = editorRoot;
        this.#scrollRoot =
          this.#editorRoot.closest<HTMLElement>('.notepad-editor-shell');
        this.#dropIndicator = document.createElement('div');
        this.#dropIndicator.className = 'notepad-block-drop-indicator';
        this.#dropIndicator.dataset.show = 'false';
        this.#dropIndicator.style.position = 'fixed';
        this.#editorRoot.appendChild(this.#dropIndicator);

        this.#unmountBlockHandle = mountBlockHandle(
          this.#editorRoot,
          (refs) => {
            this.#content = refs.content;
            this.#addButton = refs.addButton;
            this.#dragButton = refs.dragButton;
            refs.addButton.style.display = 'none';

            refs.content.addEventListener(
              'pointerenter',
              this.#handleHandlePointerEnter
            );
            refs.content.addEventListener(
              'pointerleave',
              this.#handleHandlePointerLeave
            );
            refs.addButton.addEventListener('click', this.#handleAddClick);
            refs.dragButton.addEventListener(
              'pointerdown',
              this.#handleDragPointerDown
            );
          }
        );

        this.#editorRoot.addEventListener(
          'mousemove',
          this.#handleMouseMove,
          true
        );
        this.#editorRoot.addEventListener(
          'mouseleave',
          this.#handleMouseLeave,
          true
        );
        this.#scrollRoot?.addEventListener(
          'scroll',
          this.#handleScroll,
          true
        );
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.#laneDirty = true;
          this.#dropSlotsDirty = true;
        }
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged
        ) {
          this.#scheduleCurrentBlockSync();
        }
      }

      destroy() {
        this.#destroyed = true;
        this.#editorRoot.removeEventListener(
          'mousemove',
          this.#handleMouseMove,
          true
        );
        this.#editorRoot.removeEventListener(
          'mouseleave',
          this.#handleMouseLeave,
          true
        );
        this.#scrollRoot?.removeEventListener(
          'scroll',
          this.#handleScroll,
          true
        );
        window.removeEventListener(
          'pointermove',
          this.#handleWindowPointerMove,
          true
        );
        window.removeEventListener(
          'pointerup',
          this.#handleWindowPointerUp,
          true
        );
        window.removeEventListener(
          'pointercancel',
          this.#handleWindowPointerUp,
          true
        );
        this.#dropIndicator.remove();
        this.#content?.removeEventListener(
          'pointerenter',
          this.#handleHandlePointerEnter
        );
        this.#content?.removeEventListener(
          'pointerleave',
          this.#handleHandlePointerLeave
        );
        this.#unmountBlockHandle();
      }

      #handleMouseMove = (event: MouseEvent) => {
        this.#pointerX = event.clientX;
        this.#pointerY = event.clientY;
        if (this.#drag?.dragging) {
          return;
        }

        const anchor = this.#resolveAnchorAtClientY(event.clientY);
        if (!anchor) {
          this.#hideHandle();
          return;
        }

        if (
          this.#currentBlock &&
          this.#currentBlock.from === anchor.block.from &&
          this.#currentBlock.to === anchor.block.to &&
          this.#content?.dataset.show === 'true' &&
          !this.#laneDirty
        ) {
          return;
        }

        this.#pendingAnchor = anchor;
        this.#scheduleCurrentBlockSync();
      };

      #handleMouseLeave = (event: MouseEvent) => {
        if (this.#drag?.dragging) return;
        const relatedTarget = event.relatedTarget;
        if (
          relatedTarget instanceof Node &&
          this.#content?.contains(relatedTarget)
        ) {
          return;
        }
        if (!this.#hoveringHandle) {
          this.#hideHandle();
        }
      };

      #handleHandlePointerEnter = () => {
        this.#hoveringHandle = true;
      };

      #handleHandlePointerLeave = (event: PointerEvent) => {
        this.#hoveringHandle = false;
        if (this.#drag?.dragging) return;

        const relatedTarget = event.relatedTarget;
        if (
          relatedTarget instanceof Node &&
          this.#editorRoot.contains(relatedTarget)
        ) {
          return;
        }
        this.#hideHandle();
      };

      #handleScroll = () => {
        this.#laneDirty = true;
        if (this.#currentBlock) {
          this.#syncCurrentBlock();
        }
        if (this.#drag?.dragging) {
          this.#renderDropIndicator();
        }
      };

      #handleAddClick = () => {
        if (this.#currentBlock) {
          insertParagraphBelow(this.#view, this.#currentBlock);
        }
      };

      #handleDragPointerDown = (event: PointerEvent) => {
        if (!this.#currentBlock || !this.#dragButton) return;

        event.preventDefault();
        this.#drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          source: this.#currentBlock,
          before: true,
          target: null,
          dragging: false,
          indicatorDocY: null
        };
        this.#dropSlotsDirty = true;
        window.addEventListener(
          'pointermove',
          this.#handleWindowPointerMove,
          true
        );
        window.addEventListener(
          'pointerup',
          this.#handleWindowPointerUp,
          true
        );
        window.addEventListener(
          'pointercancel',
          this.#handleWindowPointerUp,
          true
        );
      };

      #handleWindowPointerMove = (event: PointerEvent) => {
        const drag = this.#drag;
        if (!drag || event.pointerId !== drag.pointerId) return;

        const movedEnough =
          Math.abs(event.clientX - drag.startX) > 5 ||
          Math.abs(event.clientY - drag.startY) > 5;
        if (!drag.dragging && !movedEnough) return;

        drag.dragging = true;
        this.#content?.setAttribute('data-dragging', 'true');
        const slot = this.#resolveDropSlot(event.clientY);
        if (!slot) {
          this.#hideDropIndicator();
          return;
        }

        drag.target = slot.target;
        drag.before = slot.before;
        drag.indicatorDocY = slot.indicatorDocY;
        this.#renderDropIndicator();
      };

      #handleWindowPointerUp = (event: PointerEvent) => {
        const drag = this.#drag;
        if (!drag || event.pointerId !== drag.pointerId) return;

        window.removeEventListener(
          'pointermove',
          this.#handleWindowPointerMove,
          true
        );
        window.removeEventListener(
          'pointerup',
          this.#handleWindowPointerUp,
          true
        );
        window.removeEventListener(
          'pointercancel',
          this.#handleWindowPointerUp,
          true
        );

        this.#content?.setAttribute('data-dragging', 'false');
        this.#hideDropIndicator();

        if (!drag.dragging) {
          if (!this.#selectionIncludesBlock(drag.source)) {
            this.#focusBlock(drag.source);
          }
          if (this.#dragButton) {
            setSlashMenuFloatingReference(this.#view, this.#dragButton);
          }
          showSlashMenu(this.#view, drag.source.from);
          this.#drag = null;
          return;
        }

        if (
          drag.target &&
          (drag.target.from !== drag.source.from ||
            drag.target.to !== drag.source.to)
        ) {
          moveBlockTo(
            this.#view,
            drag.source,
            drag.target,
            drag.before
          );
        }
        this.#drag = null;
      };

      #focusBlock(block: BlockDescriptor) {
        this.#view.dispatch({
          selection: { anchor: block.from, head: block.from },
          scrollIntoView: true,
          annotations: [isolateHistory.of('full')]
        });
        this.#view.focus();
      }

      #selectionIncludesBlock(block: BlockDescriptor) {
        const selection = this.#view.state.selection.main;
        return (
          !selection.empty &&
          selection.from <= block.to &&
          selection.to >= block.from
        );
      }

      #scheduleCurrentBlockSync() {
        if (this.#measureQueued || this.#destroyed) return;

        this.#measureQueued = true;
        this.#view.requestMeasure({
          read: () => {
            const anchor =
              this.#pendingAnchor ??
              (this.#currentBlock
                ? this.#resolveAnchorAtClientY(this.#pointerY)
                : null);
            if (!anchor) return null;

            const placement = this.#measureHandlePlacement(
              anchor,
              this.#readHandleLaneMetrics()
            );
            return placement ? { anchor, ...placement } : null;
          },
          write: (measurement) => {
            this.#measureQueued = false;
            if (this.#destroyed || !measurement) return;

            this.#pendingAnchor = null;
            this.#currentBlock = measurement.anchor.block;
            this.#renderMeasuredHandle(
              measurement.left,
              measurement.top,
              measurement.anchor.block.from
            );
          }
        });
      }

      #syncCurrentBlock() {
        if (!this.#currentBlock) return;
        const anchor = this.#resolveAnchorAtClientY(this.#pointerY);
        if (!anchor) return;

        this.#pendingAnchor = anchor;
        this.#scheduleCurrentBlockSync();
      }

      #renderMeasuredHandle(left: number, top: number, blockPos: number) {
        if (!this.#content) return;
        this.#content.dataset.show = 'true';
        this.#content.dataset.blockPos = String(blockPos);
        this.#content.style.left = `${left}px`;
        this.#content.style.top = `${top}px`;
      }

      #measureHandlePlacement(
        anchor: VisualLineAnchor,
        lane: HandleLaneMetrics | null
      ) {
        if (!lane) return null;
        return {
          left: Math.round(lane.left),
          top: Math.round(
            this.#view.documentTop +
              anchor.centerDocY -
              lane.rootTop -
              lane.handleHeight / 2
          )
        };
      }

      #hideHandle() {
        if (!this.#content) return;
        this.#currentBlock = null;
        this.#content.dataset.show = 'false';
      }

      #renderDropIndicator() {
        const drag = this.#drag;
        if (!drag?.target || drag.indicatorDocY == null) {
          this.#hideDropIndicator();
          return;
        }

        const lane = this.#laneDirty
          ? this.#readHandleLaneMetrics()
          : this.#laneMetrics;
        if (!lane) {
          this.#hideDropIndicator();
          return;
        }
        this.#dropIndicator.dataset.show = 'true';
        this.#dropIndicator.style.left = `${Math.round(lane.textLeft + 4)}px`;
        this.#dropIndicator.style.top = `${Math.round(
          this.#view.documentTop + drag.indicatorDocY - 1
        )}px`;
        this.#dropIndicator.style.width = `${Math.max(
          120,
          Math.round(lane.surfaceWidth - lane.paddingLeft - 8)
        )}px`;
      }

      #resolveDropSlot(pointerY: number) {
        const slots = this.#getDropSlots();
        if (slots.length === 0) return null;

        const pointerDocY = pointerY - this.#view.documentTop;
        return slots.reduce((best, slot) =>
          Math.abs(slot.indicatorDocY - pointerDocY) <
          Math.abs(best.indicatorDocY - pointerDocY)
            ? slot
            : best
        );
      }

      #resolveAnchorAtClientY(clientY: number) {
        const pointerDocY = clientY - this.#view.documentTop;
        const lineBlock = this.#view.lineBlockAtHeight(pointerDocY);
        if (
          pointerDocY < lineBlock.top ||
          pointerDocY > lineBlock.top + lineBlock.height
        ) {
          return null;
        }

        const block = describeBlockAt(this.#view.state, lineBlock.from);
        return block ? this.#resolveAnchorForBlock(block) : null;
      }

      #resolveAnchorForBlock(block: BlockDescriptor) {
        const lineBlock = this.#view.lineBlockAt(block.from);
        if (!lineBlock) return null;

        return {
          block,
          docTop: lineBlock.top,
          docBottom: lineBlock.top + lineBlock.height,
          centerDocY: lineBlock.top + lineBlock.height / 2
        };
      }

      #readHandleLaneMetrics() {
        if (!this.#content) return null;
        if (this.#laneMetrics && !this.#laneDirty) {
          return this.#laneMetrics;
        }

        const surface = getEditorContentSurface(this.#view);
        const surfaceRect = surface.getBoundingClientRect();
        const rootRect = this.#editorRoot.getBoundingClientRect();
        const insetValue = getComputedStyle(surface)
          .getPropertyValue('--gn-editor-side-inset-left')
          .trim();
        const paddingLeft = resolveCssLength(
          surface,
          insetValue || '0px'
        );
        const handleRect = this.#content.getBoundingClientRect();
        const nextMetrics = {
          rootTop: rootRect.top,
          left:
            surfaceRect.left -
            rootRect.left +
            Math.max(8, paddingLeft - handleRect.width - 8),
          textLeft: surfaceRect.left + paddingLeft,
          paddingLeft,
          surfaceWidth: surfaceRect.width,
          handleHeight: Math.max(30, handleRect.height)
        } satisfies HandleLaneMetrics;
        this.#laneMetrics = nextMetrics;
        this.#laneDirty = false;
        return nextMetrics;
      }

      #getDropSlots() {
        if (this.#dropSlots && !this.#dropSlotsDirty) {
          return this.#dropSlots;
        }

        const anchors = listBlocks(this.#view.state)
          .map((block) => this.#resolveAnchorForBlock(block))
          .filter((entry): entry is VisualLineAnchor => entry !== null);
        if (anchors.length === 0) {
          this.#dropSlots = [];
          this.#dropSlotsDirty = false;
          return this.#dropSlots;
        }

        const slots: DropSlot[] = [
          {
            target: anchors[0].block,
            before: true,
            indicatorDocY: anchors[0].docTop
          }
        ];
        for (let index = 1; index < anchors.length; index += 1) {
          const previous = anchors[index - 1];
          const current = anchors[index];
          slots.push({
            target: current.block,
            before: true,
            indicatorDocY:
              (previous.docBottom + current.docTop) / 2
          });
        }
        const last = anchors[anchors.length - 1];
        slots.push({
          target: last.block,
          before: false,
          indicatorDocY: last.docBottom
        });

        this.#dropSlots = slots;
        this.#dropSlotsDirty = false;
        return slots;
      }

      #hideDropIndicator() {
        this.#dropIndicator.dataset.show = 'false';
      }
    }
  );
}
