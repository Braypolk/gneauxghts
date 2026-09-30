import { tick } from 'svelte';

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
      const durationToken = style.getPropertyValue('--pane-transition-duration').trim();
      const duration = reducedMotion.matches ? 0 : parseFloat(durationToken) * (
        durationToken.endsWith('ms') ? 1 : 1000
      );
      if (!Number.isFinite(duration) || duration <= 0 || !shell.animate) return;
      const options: KeyframeAnimationOptions = {
        duration,
        easing: style.getPropertyValue('--pane-transition-ease').trim(),
        fill: 'both'
      };
      const panes = [...shell.querySelectorAll<HTMLElement>(PANE)];
      const drawer = shell.querySelector<HTMLElement>('.related-drawer');
      const participants = [outer, area, card, ...panes, ...(drawer ? [drawer] : [])];
      // Read all destination geometry before installing any animation effects.
      const after = new Map(participants.map(element => [element, geometry(element)]));
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
        animations.push(element.animate([from, to], options));
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
