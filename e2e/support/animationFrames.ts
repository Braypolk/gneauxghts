import { browser } from '@wdio/globals';

/** Serialized by WebDriver: deliberately captures no Node/module state. */
function sampleTwoAnimationFrames() {
 return new Promise<string | null>(done => {
  let frameId = 0;
  let finished = false;
  const finish = (error: string | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    cancelAnimationFrame(frameId);
    done(error);
  };
  const deadline = setTimeout(() => finish(
    `Two animation frames were not delivered; visibility=${document.visibilityState}`
  ), 5000);
  frameId = requestAnimationFrame(() => {
    if (finished) return;
    frameId = requestAnimationFrame(() => finish(null));
  });
 });
}

export async function waitForTwoAnimationFrames() {
  const error = await browser.execute(sampleTwoAnimationFrames);
  if (error) throw new Error(error);
}
