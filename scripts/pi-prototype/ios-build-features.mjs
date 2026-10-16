// Crash-capable simulator builds are explicit disposable diagnostics only.
export function iosBuildFeatures(env) {
  const enabled = env.PI_PROTOTYPE_IOS_CRASH_FIXTURES;
  if (enabled === undefined || enabled === 'false') return 'pi-prototype,tauri/custom-protocol';
  if (enabled !== 'true' || env.PI_PROTOTYPE_DIAGNOSTICS !== 'true' || env.PI_PROTOTYPE_EXPANDED_GATE !== 'true') {
    throw new Error('iOS crash fixtures require explicit expanded disposable diagnostics');
  }
  return 'pi-prototype,e2e-chat-fixture,tauri/custom-protocol';
}
