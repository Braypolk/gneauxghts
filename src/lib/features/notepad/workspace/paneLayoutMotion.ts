import { tick } from 'svelte';
import { clockProgress as dockClockProgress, containerMorphDuration as dockMorphDuration, type ContainerEasing as DockMotionEasing } from '../../../ui/morphing-containers/motion';

const PANE = '.notepad-pane';
const CARD = '.notepad-workspace-card';
const CONTENT = '[data-pane-content]';
const FRAME = '[data-pane-frame]';
const RAIL = '.pane-rail-surface';
const LABEL = '.pane-rail-label';
const VIEWPORT = '.pane-viewport';

interface Geometry {
  width: number;
  height: number;
  bottomEdge: number;
  opacity: string;
  left: string;
  marginLeft: string;
  marginRight: string;
  x: number;
  right: string;
  bottom: string;
  clipInset: number;
  targetClipInset: number;
}

/** Interpolate measured CSS values, including the clip's percentage/length width. */
function interpolateValue(start: Keyframe[string], end: Keyframe[string], progress: number) {
  if (start === end) return start;
  const numbers = /[+-]?(?:\d+\.?\d*|\.\d+)/g;
  const from = String(start).match(numbers), to = String(end).match(numbers);
  if (!from || !to || from.length !== to.length ||
    String(start).replace(numbers, '#') !== String(end).replace(numbers, '#')) {
    return progress < 0.5 ? start : end;
  }
  let index = 0;
  return String(end).replace(numbers, () => {
    const a = Number(from[index]), b = Number(to[index++]);
    return String(a + (b - a) * progress);
  });
}

function geometry(element: HTMLElement): Geometry {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    bottomEdge: rect.bottom,
    opacity: style.opacity,
    left: style.left,
    marginLeft: style.marginLeft,
    marginRight: style.marginRight,
    x: rect.left,
    right: style.right,
    bottom: style.bottom,
    clipInset: element.matches(VIEWPORT)
      ? Math.max(0, element.parentElement!.getBoundingClientRect().width - rect.width) : 0,
    targetClipInset: parseFloat(style.getPropertyValue('--pane-clip-inset')) || 0
  };
}

/**
 * Presentation only: the workspace still owns pane membership and departure.
 * Capture before Svelte updates, measure the destination before paint, then
 * interpolate pane widths together. Revealed bodies take their final width;
 * departing bodies keep their captured wrapping until hidden. Compact frames
 * also hold their chrome and choice/composer layout at the same fixed width.
 * Editors stay mounted. No editor copies or per-frame DOM reads.
 */
export function createPaneLayoutMotion(deps: {
  getShell: () => HTMLElement | null;
}) {
  type Target = { panes: string; rail?: string };
  let target: Target | undefined;
  let active: { finish: () => void; layoutChanged: boolean } | undefined;
  let finished = Promise.resolve();

  function cancel() {
    active?.finish();
  }

  function update(nextTarget: Target, enabled: boolean) {
    if (nextTarget.panes === target?.panes && nextTarget.rail === target?.rail) return;
    const initial = target === undefined;
    const layoutChanged = nextTarget.panes !== target?.panes;
    target = nextTarget;
    const shell = deps.getShell();
    if (initial || !enabled || !shell) {
      cancel();
      return;
    }
    const area = shell.closest<HTMLElement>('.notepad-area');
    const outer = shell.closest<HTMLElement>('.notepad-area-shell');
    const card = shell.querySelector<HTMLElement>(CARD);
    if (!area || !outer || !card) return;
    const navigation = shell.closest('.app-shell')?.querySelector<HTMLElement>(
      '.app-navigation-header--compact.app-navigation-header--editor'
    );

    const inputDock = shell.querySelector<HTMLElement>('.workspace-input-dock');
    const dockRow = inputDock?.closest<HTMLElement>('.search-dock-row');
    const dockElements = inputDock && dockRow ? [inputDock, dockRow] : [];
    const elements = [outer, area, card, ...dockElements, ...(navigation ? [navigation] : []), ...shell.querySelectorAll<HTMLElement>(
      `${PANE}, ${FRAME}, ${CONTENT}, ${RAIL}, ${VIEWPORT}`
    )];
    // Capture the source presentation before DOM changes. Every rail edge
    // keeps the dock's timing even when its destination is solo layout.
    const before = new Map(elements.map(element => [element, geometry(element)]));
    const displayedRailEntry = [...before.entries()].find(([element, pose]) => element.matches(RAIL) && Number(pose.opacity) > 0.5);
    // Snapshot only inert label chrome, never editor/chat content. Retargeting
    // retains the displayed blend before the previous operation removes it.
    const labelsBefore = [...(displayedRailEntry?.[0].querySelectorAll<HTMLElement>(LABEL) ?? [])]
      .map(label => ({ node: label.cloneNode(true) as HTMLElement, opacity: Number(getComputedStyle(label).opacity) }))
      .filter(label => label.opacity > 0.01);
    // Capture the dock while the previous pane effects still paint its pose.
    shell.dispatchEvent(new CustomEvent('workspace-pane-layout-start'));
    // Capture interrupted motion's displayed dimensions before cancelling it.
    cancel();
    const animations: Animation[] = [];
    const labelSnapshots: HTMLElement[] = [];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolve!: () => void;
    finished = new Promise<void>(done => { resolve = done; });
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const operation = {
      layoutChanged,
      finish() {
        if (active !== operation) return;
        active = undefined;
        clearTimeout(timeout);
        for (const animation of animations) animation.cancel();
        for (const label of labelSnapshots) label.remove();
        // Flush the final unanimated geometry while transitions are suppressed.
        shell.removeAttribute('data-pane-motion');
        shell.removeAttribute('data-pane-layout-change');
        window.removeEventListener('resize', cancel);
        reducedMotion.removeEventListener('change', cancel);
        resolve();
      }
    };
    active = operation;
    shell.setAttribute('data-pane-motion', '');
    shell.toggleAttribute('data-pane-layout-change', layoutChanged);
    window.addEventListener('resize', cancel);
    reducedMotion.addEventListener('change', cancel);

    const animate = async () => {
      await tick();
      if (active !== operation) return;
      const panes = [...shell.querySelectorAll<HTMLElement>(PANE)];
      const compact = panes.some(pane => pane.hasAttribute('data-pane-compact'));
      const enteringCompact = compact && !displayedRailEntry && panes.some(pane => !before.has(pane));
      const dock = inputDock?.hasAttribute('data-dock-started-at') ? inputDock : null;
      const dockStartedAt = Number(dock?.dataset.dockStartedAt);
      const dockDuration = Number(dock?.dataset.dockDuration);
      const coordinatedDock = !!dock && Number.isFinite(dockStartedAt) && dockDuration > 0 && !reducedMotion.matches;
      const freshLayoutClock = coordinatedDock && dock!.hasAttribute('data-dock-clock-pending');
      // Every split entry/departure uses the same layout clock. Retained rail
      // focus exchanges can still share an in-flight dock clock.
      const capturedAt = performance.now();
      const elapsed = coordinatedDock && !freshLayoutClock ? Math.min(1, Math.max(0, (capturedAt - dockStartedAt) / dockDuration)) : 0;
      const dockEasing: DockMotionEasing = layoutChanged || !coordinatedDock || dock?.dataset.dockEasing === 'editor' ? 'editor'
        : 'pinch';
      const originProgress = dockClockProgress(elapsed, dockEasing);
      const duration = reducedMotion.matches ? 0 : coordinatedDock ? dockDuration * (1 - elapsed) : dockMorphDuration;
      if (!Number.isFinite(duration) || duration <= 0 || !shell.animate) return;
      const options: KeyframeAnimationOptions = {
        duration,
        easing: 'linear',
        fill: 'both'
      };
      const compactSurfaces = panes.flatMap(pane => pane.hasAttribute('data-pane-compact')
        ? [...pane.querySelectorAll<HTMLElement>(`${FRAME}, ${RAIL}, ${CONTENT}, ${VIEWPORT}`)] : []);
      const participants = [outer, area, card, ...dockElements, ...panes, ...compactSurfaces, ...(navigation ? [navigation] : [])];
      // Read all destination geometry before installing any animation effects.
      const after = new Map(participants.map(element => [element, geometry(element)]));
      if (inputDock) after.set(inputDock, geometry(inputDock));
      const dockDestination = inputDock ? after.get(inputDock) : undefined;
      // New panes reveal one settled layout, including titles, choices and
      // chat controls. Existing panes keep their fluid chrome and stable text.
      const contentByPane = new Map(panes.map(pane => [
        pane, pane.querySelector<HTMLElement>(compact || !before.has(pane) ? FRAME : CONTENT)
      ]));
      const contentWidthsAfter = new Map(
        [...contentByPane.values()]
          .filter((element): element is HTMLElement => element !== null)
          .map(element => [element, element.getBoundingClientRect().width])
      );
      // Every surface follows the same remaining dock clock. Sample it once
      // per operation rather than solving the curve again for every element.
      const clockSamples = Array.from({ length: 81 }, (_, index) => {
        const offset = index / 80;
        // Retarget from the displayed bounds using only the remaining clock.
        const progress = offset === 0 || offset === 1 ? offset :
          (dockClockProgress(elapsed + (1 - elapsed) * offset, dockEasing) - originProgress) / (1 - originProgress);
        return { offset, progress };
      });
      const add = (element: HTMLElement, from: Keyframe, to: Keyframe) => {
        // Sampling the dock's clock into linear WAAPI keyframes lets the card,
        // pane bounds follow the same selected curve.
        // Otherwise their earlier completion clips the still-moving actions.
        const keyframes = clockSamples?.map(({ offset, progress }) => {
          const frame: Keyframe = { offset };
          for (const key of Object.keys(from)) {
            frame[key] = interpolateValue(from[key], to[key], progress);
          }
          return frame;
        }) ?? [from, to];
        animations.push(element.animate(keyframes, options));
      };
      if (inputDock && dockRow) {
        const from = before.get(inputDock)!, to = after.get(inputDock)!;
        const rowFrom = before.get(dockRow)!, rowTo = after.get(dockRow)!;
        // Interpolate the dock's measured flex bounds once. Leaving flex sizing
        // active during the reveal changes coordinate systems at max-width caps
        // and can reverse the bar, even when its input mode never changes.
        const dockFrame = (box: Geometry, row: Geometry): Keyframe => ({
          position: 'absolute', left: `${box.x - row.x}px`, width: `${box.width}px`,
          bottom: `${row.bottomEdge - box.bottomEdge}px`, maxWidth: 'none', marginLeft: '0px', marginRight: '0px'
        });
        add(inputDock, dockFrame(from, rowFrom), dockFrame(to, rowTo));
      }
      for (const element of [outer, area]) {
        add(element, { maxWidth: `${before.get(element)!.width}px` }, {
          maxWidth: `${after.get(element)!.width}px`
        });
      }
      const cardFrom = before.get(card)!;
      const cardTo = after.get(card)!;
      add(card, {
        width: `${cardFrom.width}px`, marginLeft: cardFrom.marginLeft, marginRight: cardFrom.marginRight
      }, {
        width: `${cardTo.width}px`, marginLeft: cardTo.marginLeft, marginRight: cardTo.marginRight
      });
      for (const pane of panes) {
        const from = before.get(pane);
        const to = after.get(pane)!;
        add(pane, {
          flexGrow: 0, flexShrink: 0, flexBasis: `${from?.width ?? 0}px`,
          ...(!compact ? { opacity: from?.opacity ?? '1' } : {})
        }, {
          flexGrow: 0, flexShrink: 0, flexBasis: `${to.width}px`,
          ...(!compact ? { opacity: to.opacity } : {})
        });
        const content = contentByPane.get(pane);
        if (content) {
          const destinationWidth = contentWidthsAfter.get(content)!;
          // Closing content keeps its old width until its pane is removed.
          // The first compact reveal covers the solo editor in its original
          // wrapping. Restore compact sizing only once that frame is hidden.
          const coveredSolo = enteringCompact && pane.hasAttribute('data-pane-collapsed');
          const finalWidth = coveredSolo || to.width <= 1
            ? before.get(content)?.width ?? destinationWidth : destinationWidth;
          const fixedWidth = {
            width: `${finalWidth}px`, minWidth: `${finalWidth}px`, maxWidth: `${finalWidth}px`
          };
          // A constant effect holds the chosen wrapping while the surrounding
          // pane animates. Cancelling it restores responsive sizing at rest.
          add(content, fixedWidth, fixedWidth);
        }
      }
      // One opaque rail travels from the currently displayed position. Both
      // native buttons remain mounted, but only the destination rail paints.
      const displayedRail = displayedRailEntry?.[1];
      // The first split has no retained rail pose. Start just outside the card
      // and run the same rail/clip reveal used for subsequent exchanges.
      const railOrigin = displayedRail?.x ?? (enteringCompact ? cardFrom.x + cardFrom.width : undefined);
      for (const surface of compactSurfaces) {
        if (surface.matches(RAIL)) {
          const visible = surface.classList.contains('pane-rail');
          const to = after.get(surface)!;
          const pane = surface.closest<HTMLElement>(PANE)!;
          const fromLeft = visible && railOrigin !== undefined
            ? `${railOrigin - (before.get(pane)?.x ?? after.get(pane)!.x)}px` : to.left;
          add(surface, { opacity: visible ? 1 : 0, left: fromLeft }, {
            opacity: visible ? 1 : 0, left: to.left
          });
          if (visible && labelsBefore.length) {
            const label = surface.querySelector<HTMLElement>(LABEL)!;
            add(label, { opacity: 0 }, { opacity: 1 });
            for (const snapshot of labelsBefore) {
              snapshot.node.setAttribute('aria-hidden', 'true');
              snapshot.node.setAttribute('data-rail-label-snapshot', '');
              snapshot.node.style.position = 'absolute';
              snapshot.node.style.pointerEvents = 'none';
              surface.append(snapshot.node);
              labelSnapshots.push(snapshot.node);
              add(snapshot.node, { opacity: snapshot.opacity }, { opacity: 0 });
            }
          }
        } else if (surface.matches(VIEWPORT)) {
          const from = before.get(surface) ?? after.get(surface)!;
          const to = after.get(surface)!;
          // Opening, exchange and closing share one outer-edge-anchored clip.
          // The fixed frame keeps its wrapping even when this clip reaches zero.
          add(surface, { width: `calc(100% - ${from.clipInset}px)` }, {
            width: `calc(100% - ${to.targetClipInset}px)`
          });
        } else if (surface.matches(CONTENT)) {
          // The motion marker keeps frames opaque without an opacity effect,
          // which would isolate their backdrop filters even at constant 1.
          const frame = surface.closest<HTMLElement>(FRAME)!;
          const from = !before.has(frame) || Number(before.get(frame)?.opacity) === 0 ? 0.85 : Number(before.get(surface)?.opacity ?? 1);
          const to = frame.closest(PANE)!.hasAttribute('data-pane-collapsed') ? 0.85 : 1;
          add(surface, { opacity: from }, { opacity: to });
        }
      }
      // The compact tab selector lives outside the pane shell. Its bounds
      // must follow this same clock and cancellation path, rather than jump
      // when collapsed-pane attributes change before the reveal starts.
      if (navigation) {
        const from = before.get(navigation)!;
        const to = after.get(navigation)!;
        add(navigation, { left: from.left, right: from.right }, { left: to.left, right: to.right });
      }
      // All effects share a start time, including on slower editor mounts.
      const start = document.timeline.currentTime;
      if (start !== null) for (const animation of animations) animation.startTime = start;
      if (start !== null && coordinatedDock) for (const animation of animations) {
        // The document timeline uses the performance time origin, but its
        // currentTime stays at the last frame during measurement. Backdating
        // that stale frame time by setup cost makes panes run ahead of the dock.
        animation.startTime = capturedAt;
      }
      shell.dispatchEvent(new CustomEvent('workspace-pane-layout-ready', { detail: dockDestination ? {
        id: Number(dock?.dataset.dockMotion), left: dockDestination.x, width: dockDestination.width,
        ...(freshLayoutClock ? { startedAt: capturedAt } : {})
      } : null }));
      timeout = setTimeout(operation.finish, duration + 100);
      await Promise.allSettled(animations.map(animation => animation.finished));
    };
    void animate().catch(error => {
      console.error('Pane layout animation failed:', error);
    }).finally(operation.finish);
  }

  return {
    update,
    cancel,
    get running() { return active !== undefined; },
    async wait() {
      // A close must wait through interrupted layout too, rather than remove its pane
      // when the superseded animation resolves.
      while (active) await finished;
    }
  };
}
