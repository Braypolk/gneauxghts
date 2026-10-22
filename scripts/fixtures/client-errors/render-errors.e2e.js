import { browser, $, $$, expect } from '@wdio/globals';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const evidence = fileURLToPath(new URL('../../../.scratch/package-capabilities/evidence/client-errors/', import.meta.url));

async function screenshot(name) {
  await mkdir(evidence, { recursive: true });
  await browser.saveScreenshot(`${evidence}${name}.png`);
}

async function assertSafeFallback(heading, status) {
  await expect($('#client-error-heading')).toHaveText(heading);
  await expect($$('#client-error-heading')).toBeElementsArrayOfSize(1);
  await expect($('#client-error-summary')).toHaveValue(expect.stringContaining(`Status: ${status}`));
  const before = await $('#client-error-summary').getValue();
  await browser.keys('Tab');
  await expect($('#client-error-summary')).toBeFocused();
  await expect($('#client-error-summary')).toHaveAttribute('readonly');
  await expect($('body')).not.toHaveText(expect.stringContaining('SECRET'));
  await expect($$('button, a')).toBeElementsArrayOfSize(0);
  await browser.execute(() => Promise.resolve());
  await expect($('#client-error-summary')).toHaveValue(before);
}

describe('SvelteKit child render error presentation', () => {
  it('presents a real initial render failure safely at a wide viewport', async () => {
    await browser.setViewport({ width: 1440, height: 1000 });
    await browser.url('/initial');
    await assertSafeFallback('Workspace unavailable', 500);
    await expect($('body')).toHaveText(expect.stringContaining('Recent changes may not have been saved.'));
    await screenshot('initial-wide');
  });

  it('replaces the child after an update failure and fits a narrow viewport', async () => {
    await browser.setViewport({ width: 390, height: 844 });
    await browser.url('/update');
    await expect($('body')).toHaveText(expect.stringContaining('Child rendered normally'));
    await $('button').click();
    await assertSafeFallback('Workspace unavailable', 500);
    expect(await browser.execute(() => window.innerWidth)).toBe(390);
    const overflow = await browser.execute(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await screenshot('update-narrow');
  });

  it('keeps an expected application 404 distinct from an unexpected failure', async () => {
    await browser.url('/expected');
    await assertSafeFallback('Page unavailable', 404);
    await expect($('body')).not.toHaveText(expect.stringContaining('Recent changes'));
    await screenshot('expected-404');
  });
});
