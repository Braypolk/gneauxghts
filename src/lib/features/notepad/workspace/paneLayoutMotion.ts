import { tick } from 'svelte';
import { dockClockProgress, type DockMotionEasing } from '../ui/workspaceDockMachine';

const PANE = '.notepad-pane';
const CARD = '.notepad-workspace-card';
const CONTENT = '[data-pane-content]';
const FRAME = '[data-pane-frame]';

interface Geometry {
  width: number;
  opacity: string;
  left: string;
  marginLeft: string;
  marginRight: string;
}

function geometry(element: HTMLElement): Geometry {
  const style = getComputedStyle(element);
  return {
    width: element.getBoundingClientRect().width,
    opacity: style.opacity,
    left: style.left,
    marginLeft: style.marginLeft,
    marginRight: style.marginRight
  };
}

/**
 * Presentation only: the workspace still owns pane membership and departure.
 * Capture before Svelte updates, measure the destination before paint, then
 * interpolate pane widths together. Document/transcript bodies immediately
 * take their final width and stay visible as the pane reveals them. Entering
 * panes also hold their chrome and choice/composer layout at its final width.
 * Editors stay mounted. No editor copies or per-frame DOM reads.
 */
export function createPaneLayoutMotion(deps: {
  getShell: () => HTMLElement | null;
  updateRelatedLayout: () => void;
}) {
  let target: string | undefined;
  let active: { finish: () => void } | undefined;
  let finished = Promise.resolve();

  function cancel() {
    active?.finish();
  }

  function update(nextTarget: string, enabled: boolean, retarget = false) {
    if (nextTarget === target && !retarget) return;
    const initial = target === undefined;
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

    const elements = [outer, area, card, ...shell.querySelectorAll<HTMLElement>(
      `${PANE}, .related-drawer`
    )];
    const before = new Map(elements.map(element => [element, geometry(element)]));
    const contentWidthsBefore = new Map(
      [...shell.querySelectorAll<HTMLElement>(CONTENT)]
        .map(element => [element, element.getBoundingClientRect().width])
    );
    // Capture interrupted motion's displayed dimensions before cancelling it.
    cancel();
    const animations: Animation[] = [];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolve!: () => void;
    finished = new Promise<void>(done => { resolve = done; });
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const operation = {
      finish() {
        if (active !== operation) return;
        active = undefined;
        clearTimeout(timeout);
        for (const animation of animations) animation.cancel();
        // Flush the final unanimated geometry while transitions are suppressed.
        deps.updateRelatedLayout();
        shell.removeAttribute('data-pane-motion');
        window.removeEventListener('resize', cancel);
        reducedMotion.removeEventListener('change', cancel);
        resolve();
      }
    };
    active = operation;
    shell.setAttribute('data-pane-motion', '');
    window.addEventListener('resize', cancel);
    reducedMotion.addEventListener('change', cancel);

    const animate = async () => {
      await tick();
      if (active !== operation) return;
      // The route now has its destination size. Resolve Related's reservation
      // once at that size, not against every intermediate animation frame.
      deps.updateRelatedLayout();
      await tick();
      if (active !== operation) return;
      const style = getComputedStyle(shell);
      const dock = shell.querySelector<HTMLElement>('[data-dock-started-at]');
      const dockStartedAt = Number(dock?.dataset.dockStartedAt);
      const dockDuration = Number(dock?.dataset.dockDuration);
      const coordinatedDock = !!dock && Number.isFinite(dockStartedAt) && dockDuration > 0 && !reducedMotion.matches;
      const capturedAt = performance.now();
      const elapsed = coordinatedDock ? Math.min(1, Math.max(0, (capturedAt - dockStartedAt) / dockDuration)) : 0;
      const dockEasing: DockMotionEasing = dock?.dataset.dockEasing === 'editor' ? 'editor' : 'pinch';
      const originProgress = dockClockProgress(elapsed, dockEasing);
      const durationToken = style.getPropertyValue('--pane-transition-duration').trim();
      const duration = reducedMotion.matches ? 0 : coordinatedDock ? dockDuration * (1 - elapsed) : parseFloat(durationToken) * (
        durationToken.endsWith('ms') ? 1 : 1000
      );
      if (!Number.isFinite(duration) || duration <= 0 || !shell.animate) return;
      const options: KeyframeAnimationOptions = {
        duration,
        easing: coordinatedDock ? 'linear' : style.getPropertyValue('--pane-transition-ease').trim(),
        fill: 'both'
      };
      const panes = [...shell.querySelectorAll<HTMLElement>(PANE)];
      const drawer = shell.querySelector<HTMLElement>('.related-drawer');
      const participants = [outer, area, card, ...panes, ...(drawer ? [drawer] : [])];
      // Read all destination geometry before installing any animation effects.
      const after = new Map(participants.map(element => [element, geometry(element)]));
      // Measure the dock's final flex space without its temporary displayed
      // Related margins. Publish this endpoint after installing the pane effects.
      const row = dock?.parentElement;
      const reservation = row?.style.getPropertyValue('--dock-layout-reserved') ?? '';
      const balance = row?.style.getPropertyValue('--dock-layout-balance') ?? '';
      row?.style.removeProperty('--dock-layout-reserved');
      row?.style.removeProperty('--dock-layout-balance');
      const dockDestination = dock?.getBoundingClientRect();
      if (reservation) row?.style.setProperty('--dock-layout-reserved', reservation);
      if (balance) row?.style.setProperty('--dock-layout-balance', balance);
      // New panes reveal one settled layout, including titles, choices and
      // chat controls. Existing panes keep their fluid chrome and stable text.
      const contentByPane = new Map(panes.map(pane => [
        pane, pane.querySelector<HTMLElement>(before.has(pane) ? CONTENT : FRAME)
      ]));
      const contentWidthsAfter = new Map(
        [...contentByPane.values()]
          .filter((element): element is HTMLElement => element !== null)
          .map(element => [element, element.getBoundingClientRect().width])
      );
      const add = (element: HTMLElement, from: Keyframe, to: Keyframe) => {
        // Sampling the dock's clock into linear WAAPI keyframes lets the card,
        // pane bounds and Related reservation follow the same selected curve.
        // Otherwise their earlier completion clips the still-moving actions.
        const keyframes = !coordinatedDock ? [from, to] : Array.from({ length: 81 }, (_, index) => {
          const offset = index / 80;
          // A retarget begins at the displayed bounds and consumes only the
          // remaining clock, rather than sampling the old progress twice.
          const progress = offset === 0 || offset === 1 ? offset :
            (dockClockProgress(elapsed + (1 - elapsed) * offset, dockEasing) - originProgress) / (1 - originProgress);
          const frame: Keyframe = { offset };
          for (const key of Object.keys(from)) {
            const start = from[key], end = to[key];
            if (start === end) frame[key] = start;
            else {
              const a = parseFloat(String(start)), b = parseFloat(String(end));
              const unit = String(end).replace(/^[+-]?(?:\d+\.?\d*|\.\d+)/, '');
              frame[key] = Number.isFinite(a) && Number.isFinite(b)
                ? `${a + (b - a) * progress}${unit}` : progress < 0.5 ? start : end;
            }
          }
          return frame;
        });
        animations.push(element.animate(keyframes, options));
      };
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
          flexGrow: 0, flexShrink: 0, flexBasis: `${from?.width ?? 0}px`, opacity: from?.opacity ?? '1'
        }, {
          flexGrow: 0, flexShrink: 0, flexBasis: `${to.width}px`, opacity: to.opacity
        });
        const content = contentByPane.get(pane);
        if (content) {
          const destinationWidth = contentWidthsAfter.get(content)!;
          // Closing content keeps its old width until its pane is removed.
          const finalWidth = to.width > 1
            ? destinationWidth
            : contentWidthsBefore.get(content) ?? destinationWidth;
          const fixedWidth = {
            width: `${finalWidth}px`, minWidth: `${finalWidth}px`, maxWidth: `${finalWidth}px`
          };
          // A constant effect holds the final wrapping while the surrounding
          // pane animates. Cancelling it restores responsive sizing at rest.
          add(content, fixedWidth, fixedWidth);
        }
      }
      if (drawer) {
        const from = before.get(drawer);
        const to = after.get(drawer)!;
        add(drawer, { left: from?.left ?? to.left, opacity: from?.opacity ?? '0' }, {
          left: to.left, opacity: to.opacity
        });
      }
      // All effects share a start time, including on slower editor mounts.
      const start = document.timeline.currentTime;
      if (start !== null) for (const animation of animations) animation.startTime = start;
      if (start !== null && coordinatedDock) for (const animation of animations) {
        animation.startTime = Number(start) - (performance.now() - capturedAt);
      }
      shell.dispatchEvent(new CustomEvent('workspace-pane-layout-ready', { detail: dockDestination ? {
        id: Number(dock?.dataset.dockMotion), left: dockDestination.left, width: dockDestination.width
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
    /** Related can change the destination while panes are moving. Capture the
     * displayed geometry before cancelling, just as for membership changes. */
    retarget() {
      if (active && target !== undefined) update(target, true, true);
    },
    get running() { return active !== undefined; },
    async wait() {
      // A close must wait through retargeting too, rather than remove its pane
      // when the superseded animation resolves.
      while (active) await finished;
    }
  };
}
