// Native-only helper. Credentials travel over private stdio, never WebView IPC.
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { createInterface } from 'node:readline';

registerBunOAuthFlows();
const abort = new AbortController();
process.stdin.on('end', () => abort.abort());
const lines = createInterface({ input: process.stdin });
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let refreshing = false;
try {
  const [line] = await Promise.race([
    new Promise(resolve => lines.once('line', line => resolve([line]))),
    new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('cancelled'))))
  ]);
  const request = JSON.parse(line);
  const oauth = openaiProvider().auth.oauth;
  let credential;
  if (request.action === 'login') {
    credential = await oauth.login({
      signal: abort.signal,
      notify(event) {
        if (event.type === 'auth_url') send(event);
        // Curated progress only: never forward a provider response or message.
        if (event.type === 'progress') send({ type: 'progress', phase: 'completing' });
      },
      prompt({ signal }) {
        send({ type: 'manual_input' });
        return new Promise((resolve, reject) => {
          const combined = AbortSignal.any([signal ?? abort.signal, abort.signal]);
          const cleanup = () => { lines.off('line', reply); combined.removeEventListener('abort', cancelled); };
          const cancelled = () => { cleanup(); reject(new Error('cancelled')); };
          const reply = line => {
            try {
              const message = JSON.parse(line);
              if (message.action !== 'manual_input' || typeof message.value !== 'string') return;
              cleanup(); resolve(message.value);
            } catch { /* Ignore malformed input; native validates the protocol. */ }
          };
          lines.on('line', reply);
          if (combined.aborted) cancelled();
          else combined.addEventListener('abort', cancelled, { once: true });
        });
      }
    }, { getDeviceId: () => request.deviceId, agentName: 'Gneauxghts', clientId: request.clientId ?? undefined });
  } else if (request.action === 'refresh') {
    refreshing = true;
    credential = await oauth.refresh(request.credential, abort.signal);
  } else throw new Error('invalid action');
  send({ type: 'credential', credential });
} catch (error) {
  // Pi errors can contain provider response bodies. Do not forward those.
  const terminalRefresh = refreshing && ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(error?.oauthError);
  send({ type: 'error', code: terminalRefresh ? 'reauthorization_required' : String(error?.message).includes('Port 1455 is in use') ? 'port_in_use' : 'authentication_failed' });
  process.exitCode = 1;
} finally {
  lines.close();
  process.stdin.destroy();
}
