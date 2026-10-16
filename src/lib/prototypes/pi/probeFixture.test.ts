import { describe, expect, it } from 'vitest';
import { probeFixtureOrigin } from './probeFixture';

describe('guarded native diagnostic fixture endpoint', () => {
  const config = { fixture: true, interactiveGate: true, expandedGate: true, fixtureBaseUrl: 'http://127.0.0.1:1443/local/v1' };
  it('uses only an explicitly gated owned IPv4 fixture origin', () => {
    expect(probeFixtureOrigin(config)).toBe('http://127.0.0.1:1443');
    expect(probeFixtureOrigin({ ...config, fixtureBaseUrl: 'http://127.0.0.1:1446' })).toBe('http://127.0.0.1:1446');
    for (const gate of ['fixture', 'interactiveGate', 'expandedGate'] as const)
      expect(() => probeFixtureOrigin({ ...config, [gate]: false })).toThrow(/synthetic gates/);
    for (const fixtureBaseUrl of [null, '', 'http://localhost:1234', 'http://localhost:1443', 'http://[::1]:1443',
      'https://127.0.0.1:1443', 'http://127.0.0.1:8080', 'http://user:secret@127.0.0.1:1443',
      'http://127.0.0.1:1443?token=secret', 'http://127.0.0.1:1443#secret', 'http://2130706433:1443', 'http://127.1:1443'])
      expect(() => probeFixtureOrigin({ ...config, fixtureBaseUrl })).toThrow();
  });
});
