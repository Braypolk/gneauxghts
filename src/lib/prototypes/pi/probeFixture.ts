// Diagnostic endpoints come only from the explicitly enabled native fixture.
export type NativeProbeConfig = { fixture: boolean; interactiveGate: boolean; expandedGate: boolean; followonsGate?: boolean;
  iosTarget: boolean; iosPublicationFaultGate: boolean; fixtureBaseUrl: string | null };
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export function ownedFixtureOrigin(endpoint: string | null | undefined) {
  assert(endpoint, 'Diagnostic gate requires the explicit fixture endpoint');
  const url = new URL(endpoint);
  assert(/^http:\/\/127\.0\.0\.1(?=[:/]|$)/.test(endpoint) && url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && !url.search && !url.hash,
    'Diagnostic control requires an explicit IPv4 loopback HTTP fixture');
  assert(url.port === '1443' || url.port === '1446', 'Diagnostic control requires an owned fixture port');
  return url.origin;
}

export function probeFixtureOrigin(config: Pick<NativeProbeConfig, 'fixture' | 'interactiveGate' | 'expandedGate' | 'fixtureBaseUrl'>) {
  assert(config.fixture && config.interactiveGate && config.expandedGate, 'Diagnostic endpoint requires explicit expanded synthetic gates');
  return ownedFixtureOrigin(config.fixtureBaseUrl);
}
