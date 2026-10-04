import { browser } from '@wdio/globals';

/** Wait for observable finite workspace motion; perpetual editor cursor blink is unrelated. */
export async function waitForWorkspaceAnimationSettled() {
  await browser.waitUntil(async () => browser.execute(() => {
    const shell = document.querySelector('.notepad-shell');
    return !!shell && !document.querySelector('[data-pane-motion]') &&
      !shell.getAnimations({ subtree: true }).some(animation =>
        (animation.playState === 'running' || animation.pending) &&
        animation.effect?.getTiming().iterations !== Infinity);
  }), { timeout: 5000, interval: 25, timeoutMsg: 'Finite workspace animation did not settle' });
}
