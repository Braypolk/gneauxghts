# T3 Code provider authentication research

Researched 2026-10-18 against public `pingdotgg/t3code` commit [`07d38b8d17167c8d17fba1184dbe13a307fada74`](https://github.com/pingdotgg/t3code/commit/07d38b8d17167c8d17fba1184dbe13a307fada74), checked out from `main`. This is a source inspection, not an authenticated T3 Code run. No user credentials were read. Findings describe this revision; the user's previously installed version may differ.

## Main finding

T3 Code has **two distinct Codex authentication paths**. Its managed ChatGPT connection performs its own OAuth and owns its own credentials. Its existing-CLI mode delegates to the installed Codex runtime and that runtime's account/configuration. The direct path uses the same `dynamic_agent_client`, `chatgpt.tokens.use.direct` scope, and `https://api.openai.com/v1` resource as the Pi OpenAI direct flow Gneauxghts currently uses. Therefore, the smoother experience does not require replacing Pi or importing a Codex CLI token. [Mode selection](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/Drivers/CodexDriver.ts#L109-L130), [direct authorization](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexChatGptAuth.ts#L506-L528).

## Managed ChatGPT: visible journey and underlying implementation

1. Onboarding and provider settings offer a managed ChatGPT connection. Setup acquires/installs Codex when needed, then automatically continues to sign-in. Existing CLI use remains an alternative. [Setup sequence](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/web/src/components/settings/CodexSetupSection.tsx#L440-L489), [user documentation](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/docs/user/providers-codex.md#L1-L29).
2. It opens the browser when the flow reaches its waiting phase, displays progress, and offers reopening the page, cancellation, and a masked field for pasting the final loopback URL if automatic return fails. Desktop can receive the callback on the user's device even when the target environment is remote; the desktop window is revealed after receiving it. [UI and fallback](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/web/src/components/settings/CodexSetupSection.tsx#L491-L688), [desktop callback bridge](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/desktop/src/ipc/methods/providerAuth.ts#L22-L48).
3. The backend owns a flow state with a unique ID, owner, interaction, deadline, and explicit starting/waiting/verifying/succeeded/failed/cancelled phases. Its default deadline is five minutes. Flow work is forked into the provider service scope; UI subscribes to state rather than owning the token exchange as a component-local promise. The desktop callback listener itself is cancelled on relevant UI cleanup, so this should not be read as a guarantee that every callback mode survives navigation. [Flow service](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/packages/provider-core/src/server/providerAuthFlow.ts#L57-L100), [background operation and phase updates](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/packages/provider-core/src/server/providerAuthFlow.ts#L240-L353), [desktop listener cleanup](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/web/src/components/settings/CodexSetupSection.tsx#L521-L528).
4. Sign-in uses OpenID discovery, PKCE S256, state, nonce, a loopback redirect, dynamic client registration, and a stable environment host identifier. Reconnection reuses the saved registered client ID and can provide `login_hint` and `id_token_hint`; a separate method registers a different account. It verifies the ID token using the issuer's JWKS, audience, allowed algorithms and nonce, then preserves the verified subject/email and connection profile. Reconnecting an existing registration rejects a different returned account. [Authorization](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexChatGptAuth.ts#L434-L552), [verification and persistence](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexChatGptAuth.ts#L579-L691), [saved-account methods](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexChatGptAuth.ts#L822-L859).
5. After sign-in, settings display the account email and reconnect/disconnect actions. Provider checks acquire a current access token, probe Codex, and load account-visible models from OpenAI's `/models`, preserving display names. Missing token-sharing permission produces a specific reconnect explanation. A transient probe failure can still retain authenticated status while showing an error, so even T3 distinguishes saved authentication from a successful current readiness check. [Connection presentation](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/web/src/components/settings/CodexSetupSection.tsx#L547-L580), [readiness checks](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/Drivers/CodexManagedProvider.ts#L65-L203), [account model catalog](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexChatGptModels.ts#L24-L46).

### Token use, refresh, and disconnect

Managed mode launches Codex with a custom `openai_token_sharing` provider using the Responses API at `api.openai.com/v1`, reads its bearer token from a child-process `ACCESS_TOKEN` environment variable, and sets `requires_openai_auth=false`. It removes ambient `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and extra Codex launch overrides to keep the managed token on its intended route. This is ordinary Codex app-server operation with a custom provider; the managed authentication implementation does not import a legacy Codex login or use `account/login/start` to inject one. [Managed runtime](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexManagedRuntime.ts#L19-L110).

Access refresh begins within sixty seconds of expiry, respects the server's earliest-refresh timestamp, rotates and persists refresh tokens, checks the required sharing scope, and uses both an in-process semaphore and a cross-process file lease around session changes. Disconnect tries remote revocation and removes local credentials; if revocation cannot be confirmed it explains how to disconnect in ChatGPT. [Refresh](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexChatGptAuth.ts#L712-L817), [cross-process coordination](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexChatGptSessionLock.ts#L8-L44).

## Credential storage and API keys

**T3's managed credential store is an owner-permission file store, not OS Keychain encryption in this layer.** Credential records are encoded as JSON bytes and handed to `ProviderCredentialStore`; that wrapper hashes a driver/instance binding into a safe filename and delegates bytes to `ServerSecretStore`. That service reads/writes the bytes directly into `<stateDir>/secrets/*.bin`, secures the directory to `0700` and files to `0600`, and uses a temporary file plus rename for replacements. The `.bin` extension and SHA-256 filename are not encryption. Machine/disk encryption is outside this implementation and was not investigated. This direct file path does not invoke macOS Keychain, which explains why this particular path would avoid executable-specific Keychain dialogs; actual UX on the user's installed T3 version was not tested. [Credential encoding](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexChatGptAuth.ts#L219-L230), [binding wrapper](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/ProviderCredentialStore.ts#L7-L23), [file implementation](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/auth/ServerSecretStore.ts#L184-L286), [store location](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/config.ts#L120-L147).

T3 is primarily a provider-agent control surface, so API-key ownership varies:

- **Existing Codex:** T3 launches the configured Codex binary/home and probes `account/read`; it recognizes API-key accounts as well as ChatGPT accounts. Its Codex settings schema has binary/home/shadow-home/launch settings, not a dedicated OpenAI key field. CLI credentials stay under Codex's own storage/configuration, or provider instance environment variables are supplied to the child process. A custom model provider that does not require OpenAI authentication can be ready without a native OpenAI account. [Codex settings](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/packages/contracts/src/settings.ts#L556-L611), [runtime probe](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexProvider.ts#L408-L485), [account classification](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/provider/CodexProvider.ts#L582-L612).
- **API-key fields and environment variables entered in T3:** provider schemas mark secret fields; environment rows have an explicit sensitive flag, defaulting to true for new rows. Sensitive values are extracted into the same server secret store, replaced by redacted placeholders/metadata in settings, and reconstructed only on the server for provider use. Subsequent client settings reads blank/redact them. On initial entry a new key necessarily exists in the password input and update payload; this is not a claim that it never enters frontend memory. Fields not marked sensitive remain ordinary settings. [Environment editor](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/web/src/components/settings/ProviderInstanceCard.tsx#L375-L483), [replacement-only input](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/web/src/components/settings/SecretInput.tsx#L1-L38), [secret mapping](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/settingsSecrets.ts#L26-L146), [redaction](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/serverSettings.ts#L131-L138), [server materialization](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/serverSettings.ts#L804-L840), [separate persistence](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/apps/server/src/serverSettings.ts#L866-L905).
- **Claude and Pi:** documented setup reuses those installed agents' authentication/configuration; API-key or router environment variables can also be supplied per instance. This is reuse of the agent runtime, not a universal cross-provider credential import API. [Claude](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/docs/user/providers-claude.md#L1-L46), [Pi](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/docs/user/providers-pi.md#L1-L31), [environment merge](https://github.com/pingdotgg/t3code/blob/07d38b8d17167c8d17fba1184dbe13a307fada74/packages/provider-core/src/server/instanceEnvironment.ts#L7-L25).

## Inspection notes and limits

Public-source checkout: `/private/tmp/t3-auth-source`, created with `git clone --depth 1 https://github.com/pingdotgg/t3code.git`. `git rev-parse HEAD` returned the pinned SHA above. Used repository text searches for direct OAuth scope, login RPCs, token refresh, credential store, settings secret redaction, and UI callback handling, then read the implementations and provider documentation. No T3 executable was run, no sign-in or network token exchange was attempted, no existing T3/Codex/Pi credential store was opened, and no app source was changed for this research.

The checked-out commit is newer than some search-engine copies of `main`; conclusions and links use the checked-out commit, not cached search snippets. T3 has additional remote profile-transfer and provider-specific authentication paths; they are not prerequisites for matching the local Gneauxghts sign-in experience and were not exhaustively audited here.

## Comparison with Gneauxghts and recommended adaptation

This section compares inspected local sources on 2026-10-18; recommendations
are engineering judgments, not claims that T3 has already solved every failure.

Our current integration already uses the same direct token-sharing OAuth family
through Pi's built-in OpenAI provider, then uses native credential ownership and
Responses transport. It does not require installing Codex or importing its login.
The accepted [Pi runtime ADR](../../docs/adr/0012-found-ordinary-chat-on-pi.md)
remains applicable: adopting T3's Codex execution backend would change the runtime,
not simply replace the login screen.

| Concern | Current Gneauxghts behavior | Useful change |
| --- | --- | --- |
| Connection UI | ChatGPT subscription, separate API-key editor and model/default controls | One OpenAI connection card with a clear active billing method; make sign-in the primary action and API-key entry an explicit alternative |
| Connection lifetime | Settings owns the visible pending state and cancels sign-in on unmount | Let the native auth owner retain an attempt across navigation and publish nonsecret progress/completion |
| Progress and callback recovery | Helper forwards only the authorization URL; its Pi manual-input hook intentionally stays pending | Forward Pi's existing progress and manual callback interaction without introducing a custom OAuth implementation |
| Health and account identity | Connected means a credential record exists; UI has no verified email or account identity | Distinguish saved credentials, a usable connection and reconnect-required status; account identity requires verified metadata support |
| Credential storage | OS keyring stores API keys and OAuth credentials separately; each resolve reads the selected record | Keep keyring storage; evaluate a native process-lifetime credential cache with refresh/write-through and clearing on replacement, disconnect or credential failure |
| Reconnect | Pi starts a new dynamic client registration for each explicit login | T3-style registration reuse/account hints need a Pi enhancement or separate maintained OAuth code; prefer upstream support |
| Callback port | Installed Pi fixes its callback at 1455 | T3's available-port approach avoids conflicts, but matching it requires Pi support for a configurable/dynamic callback port |
| Billing selection | Explicit API-key vs subscription selection, no inference fallback | Preserve explicit billing and never silently replace a failed subscription call with a billable API-key request |

Local evidence:
[connection component](../../src/lib/features/settings/ChatGptSettings.svelte),
[Pi helper](../../scripts/chatgptAuth.mjs),
[native auth owner](../../src-tauri/src/chatgpt_auth.rs),
[keyring owner](../../src-tauri/src/secrets.rs),
[native transport](../../src-tauri/src/pi_chat/transport.rs).

Installed Pi 1.3.0 source inspection:
`@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js` implements the direct
scope/resource, automatic expiry margin, progress events and browser/manual-input
race. It always requests a new dynamic registration, fixes callback port 1455,
checks that an ID token was returned but intentionally discards it rather than
returning a verified user profile. Thus showing a verified account email or using
an ID-token reconnect hint is not just a UI change with the current public auth
result. Its separate `openai-codex` provider uses a different endpoint/auth flow;
a CLI token should not simply be copied into the direct OpenAI credential slot.

The repeated OS permission prompts during our preceding live acceptance occurred
with repeatedly rebuilt development/test executables. That is separate from the
browser consent step. Process caching may reduce repeated reads within a run,
but it does not guarantee access for a rebuilt executable; development signing
and actual Keychain behavior require their own verification. T3's file store
avoids that particular Keychain access path, but copying its storage would change
our current security model.

Recommended first slice: simplify the provider connection card, retain login
progress across navigation, expose Pi's manual callback recovery, and give clear
usable/reconnect status while preserving native Keychain storage and Pi OAuth.
Then investigate/upstream verified account metadata, reusable registration and
dynamic callback ports. Existing Codex-login support would be a separate provider
integration rather than automatic credential import.

This investigation changes documentation only. It did not connect an account,
read existing user secrets, run T3 Code, or alter authentication behavior. T3
claims above are based on source inspection, not a hands-on UI acceptance run.
