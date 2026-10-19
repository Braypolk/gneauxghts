# Reuse the ChatGPT app registration — 2026-10-19

The reported ChatGPT Usage & billing screenshot showed three Gneauxghts entries.
Pi 1.3.0's OAuth login hardcodes `dynamic_agent_client` on every attempt; native
login did not supply the previously issued client ID, and disconnect deleted its
only local copy with the credential.

Native device preferences now retain the issued client ID alongside the stable
host ID. Login and disconnect adopt registration metadata from existing keyring
credentials when needed. Disconnect still removes tokens and selects API-key
billing; the next login reauthorizes the retained registration. A completed login
saves registration metadata before attempting keyring storage, preserving reuse
after a failed token-store write. Conflicting client IDs cannot replace it.

A version-pinned Pi patch adds returning-client authorization and callback
support. Pi still owns callback state/PKCE, code exchange, cancellation and token
refresh. Returning requests omit the initial registration name hint; callbacks
may omit the saved client ID but cannot supply a different one. No UI credential
or runtime ownership change is introduced.

The focused regression failed before the fix because the real helper emitted
`client_id=dynamic_agent_client` despite being given a saved issued ID. Thirteen
source-helper tests and the same thirteen bundled-helper tests pass, including
first registration, browser/manual reauthorization, client/state rejection,
refresh permission and cancellation. Three focused native tests pass, covering
registration retention through serialized preference reload, legacy adoption,
conflicting IDs, token exclusion and complete subscription credentials.

`pnpm check` passes without Svelte errors or warnings. `pnpm test` passes all 49
support tests and 1,324 frontend tests across 154 files. Frozen offline install
with scripts disabled and strict dependency-build checking disabled passes;
pnpm 12's default strict build policy otherwise reports the existing unapproved
`@google/genai` and `protobufjs` scripts. No build-script approvals were changed.
The complete native library suite passes 651 tests with 19 ignored, and all 19
native architecture fitness tests pass. The desktop
OAuth helper rebuild and production web build pass; Vite retains its existing
mixed static/dynamic import and chunk-size warnings.

This change prevents repeat registration on a host with a retained issued client
ID. It cannot merge/delete existing ChatGPT-side registrations or recover IDs
already discarded by earlier disconnects. Live browser reauthorization with the
user's account and cleanup of their existing entries were not performed. The
helper tests use synthetic tokens only.

## Connected Settings follow-up

Settings no longer offers sign-in/reconnect while a saved ChatGPT connection
exists, including when API-key billing is selected. Native login is also
idempotent for that connection. An explicit model check refreshes the safe
connection snapshot before rendering actions again.

An expired credential or rejected subscription access token can confirm revoked
access through refresh. Terminal OAuth refresh errors retire the credential
under the existing authentication gate while retaining registration metadata
and the selected billing method. A late rejection for an older access token
cannot retire a newer credential. Network errors, usage limits and configuration
errors preserve the connection. The pinned Pi patch exposes only a structured
OAuth error classification to the private helper; provider bodies and tokens
still never enter WebView status/error messages.

Opening Settings remains metadata-only. OpenAI does not send disconnect
notifications, so revocation is discovered on an explicit connection check,
inference request or token refresh; it is not known immediately when changed in
ChatGPT. See [OpenAI recovery guidance](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).

The unwanted connected-state Reconnect button failed the browser regression
before the UI fix. All 14 Settings browser journeys now pass, including connected
API-key mode, navigation, transient errors and confirmed revocation. The source
and packaged helpers each pass 17 real-helper protocol tests; these include
terminal refresh rejection plus nonterminal rate-limit/server/configuration
failures. `pnpm test` passes 53 support tests and 1,324 frontend tests across 154
files. `pnpm check` reports no errors or warnings, and the desktop OAuth helper
rebuild succeeds. The native library suite passes 651 tests with 19 ignored;
all 19 architecture fitness tests pass. The production web build succeeds with
the existing Vite import/chunk warnings. Rust formatting and `git diff --check`
pass. No live user-account revocation/reauthorization was performed.
