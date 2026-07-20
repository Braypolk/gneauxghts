/**
 * App-shell navigation helpers shared by the navbar coordinator and root layout.
 * `viewGeneration` forces `{#key}` remounts when SvelteKit's URL already matches
 * the destination but the visible page did not swap (preload / aborted goto).
 */

let viewGeneration = $state(0);

export function getAppShellViewGeneration() {
  return viewGeneration;
}

export function bumpAppShellViewGeneration() {
  viewGeneration += 1;
}
