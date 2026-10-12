import { browser, $ } from '@wdio/globals';

export async function openAppNavigation() {
  const trigger = await $('button[aria-label="Switch tab"]');
  await $('.app-navigation-header').waitForDisplayed({ timeout: 30_000 });
  if (!await trigger.isExisting()) return;
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await $('[role="menu"][aria-label="Tabs"]').waitForDisplayed();
}

export async function navigateAppTab(label: 'Map' | 'Gneauxght' | 'List' | 'Settings') {
  await openAppNavigation();
  await $(`a[aria-label="${label}"]`).click();
  await browser.waitUntil(async () => {
    const trigger = await $('button[aria-label="Switch tab"]');
    return !await trigger.isExisting() || await trigger.getAttribute('aria-expanded') === 'false';
  });
}

export async function clickPaneAction(label: 'Open thought partner' | 'Open previous location' | 'Split pane') {
  await $(`[data-testid="workspace-pane"]:not([data-pane-collapsed]) button[aria-label="${label}"]`).click();
}
