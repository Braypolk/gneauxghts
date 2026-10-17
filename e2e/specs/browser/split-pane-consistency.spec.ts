import { browser, expect, $ } from '@wdio/globals';
import { resetBrowserWorkspace } from '../../support/browserWorkspace';
import { samplePaneMotion, expectContinuousMotion, expectStableEntrance, expectDockMotion, type PaneMotionAction } from '../../support/paneMotion';
import { waitForWorkspaceAnimationSettled } from '../../support/workspaceAnimation';
import { dockClockProgress, dockMorphDuration } from '../../../src/lib/features/notepad/ui/workspaceDockMachine';

describe('consistent split entry', () => {
  for (const width of [1440, 390]) {
    for (const source of ['editor', 'chat']) {
      const actions: PaneMotionAction[] = source === 'editor'
        ? ['open', 'open-current', 'open-previous', 'open-chat']
        : ['open', 'open-current', 'open-previous'];
      for (const action of actions) {
        it(`uses the shared opening curve from ${source} via ${action} at ${width}px`, async () => {
          await resetBrowserWorkspace();
                await browser.setWindowSize(width, 1000);
          await waitForWorkspaceAnimationSettled();
          if (source === 'chat') {
            await browser.execute(() => document.querySelector<HTMLElement>('button[aria-label="Open thought partner"]')!.click());
            await $('[data-notepad-command-bar] textarea').waitForEnabled();
            await $('[data-notepad-command-bar] textarea').setValue('Retain this draft across split entry');
            await waitForWorkspaceAnimationSettled();
          }
          const result = await samplePaneMotion(action);
          const moving = result.frames.flatMap(frame => frame.panes.filter(pane => pane.motion));
          expect(moving.length).toBeGreaterThan(3);
          const durations = moving.map(pane => pane.motion!.duration);
          // Setup may consume a frame; every variant follows the same 380ms clock.
          expect(Math.max(...durations)).toBeLessThanOrEqual(dockMorphDuration);
          expect(Math.min(...durations)).toBeGreaterThan(dockMorphDuration - 50);
          for (const initial of result.before.panes) {
            const final = result.frames.at(-1)!.panes.find(pane => pane.id === initial.id)!;
            const travel = final.width - initial.width;
            const errors = result.frames.flatMap(frame => {
              const pane = frame.panes.find(pane => pane.id === initial.id);
              if (!pane?.motion || Math.abs(travel) < 5) return [];
              const progress = (pane.width - initial.width) / travel;
              const lead = dockMorphDuration - pane.motion.duration;
              const origin = dockClockProgress(lead / dockMorphDuration, 'editor');
              const expected = (dockClockProgress((lead + pane.motion.elapsed) / dockMorphDuration, 'editor') - origin) / (1 - origin);
              return [Math.abs(progress - expected)];
            });
            expect(Math.max(...errors)).toBeLessThanOrEqual(0.04);
          }
          const dockFrames = [result.before, ...result.frames].map(frame => frame.dock);
          expect(result.frames.filter(frame => frame.moving && frame.dock.easing)
            .every(frame => frame.dock.easing === 'editor')).toBe(true);
          expectDockMotion(dockFrames, `Split ${action}`);
          if (width >= 640) {
            expectContinuousMotion(result);
            expectStableEntrance(result);
          } else {
            const enteringId = result.frames.at(-1)!.panes.find(pane =>
              !result.before.panes.some(before => before.id === pane.id))!.id;
            const headers = result.frames.filter(frame => frame.moving).flatMap(frame => {
              const pane = frame.panes.find(pane => pane.id === enteringId);
              const header = pane?.layout['.pane-header'];
              return header ? [pane!.left + header.left] : [];
            });
            // Compact content stays stationary while the rail reveals it.
            expect(Math.max(...headers) - Math.min(...headers)).toBeLessThanOrEqual(1);
          }
          if (source === 'chat') {
            const pane = $(`[data-pane-id="${result.before.panes[0].id}"]`);
            if (await pane.getAttribute('data-pane-collapsed')) await pane.$('.pane-rail').click();
            else await pane.$('.pane-header-title-wrap').click();
            await waitForWorkspaceAnimationSettled();
            await expect($('[data-notepad-command-bar] textarea')).toHaveValue('Retain this draft across split entry');
          }
        });
      }
    }
  }
});
