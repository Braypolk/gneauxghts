import assert from 'node:assert/strict';
import { iosFixturePort } from './ios-fixture-config.mjs';

// Browser control requests are separate from native provider transport. Packaged
// WKWebViews use production CSP, so admit only the owned diagnostic routes there.
// No listener inspection or other native work belongs in build configuration.
// Build with PI_PROTOTYPE_IOS_FIXTURE_PORT matching the later driver's launch;
// the default 1443 build deliberately does not admit alternate-port controls.
export function iosDiagnosticCsp(config, productionCsp, mode, env) {
  if (mode !== 'ios' || env.PI_PROTOTYPE_DIAGNOSTICS !== 'true' || env.PI_PROTOTYPE_EXPANDED_GATE !== 'true') return config;
  assert(productionCsp && typeof productionCsp === 'object' && !Array.isArray(productionCsp)
    && typeof productionCsp['connect-src'] === 'string', 'Diagnostic iOS packaging requires the existing production CSP');
  const port = iosFixturePort(env), fixture = `http://127.0.0.1:${port}`, control = `http://127.0.0.1:${port + 1}`;
  const sources = [`${fixture}/__pi_supplemental_evidence`, `${control}/pi-suspension/`, `${control}/pi-ios-publication/`];
  return { ...config, app: { ...config.app, security: { ...config.app?.security,
    csp: { ...productionCsp, 'connect-src': [productionCsp['connect-src'], ...sources].join(' ') } } } };
}
