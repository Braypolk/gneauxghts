import { basename } from 'node:path';

export const foregroundNativeSpecs = [
  'search-focus', 'previous-note-focus', 'pane-animation', 'chat-pane-animation', 'workspace-dock-outline',
  'note-timeline-phase-1-3', 'editing-windows'
];

export function requireNativeForeground(reason, env = process.env) {
  if (env.GNEAUXGHTS_E2E_FOREGROUND !== '1') {
    throw new Error(`${reason} requires actual OS focus. Run in a separate desktop session, or explicitly set GNEAUXGHTS_E2E_FOREGROUND=1 when it is OK to take focus. No native app was launched.`);
  }
}

export function admitNativePresentation(specs, env = process.env) {
  const focused = specs.flat(Infinity).find(spec =>
    [...foregroundNativeSpecs, 'editing-window-native-scale', 'markdown-marker-merge', 'markdown-synchronous-paragraph', 'draft-body-latency'].includes(basename(spec).replace(/\.spec\.ts$/, '')) ||
    spec.includes('*'));
  if (focused || env.IMAGE_LOADING_OUTPUT || env.GNEAUXGHTS_E2E_SUSTAINED_MEASUREMENT === '1' || env.GNEAUXGHTS_RELEASE_SCALE_RUN) {
    requireNativeForeground(focused ? basename(focused) : 'Focused native paint measurement', env);
  }
}
