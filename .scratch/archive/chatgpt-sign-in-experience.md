# ChatGPT sign-in experience — 2026-10-18

Keep the OS credential store while making the Pi-backed sign-in flow more like
the researched T3 experience. Application changes, stable development signing,
and two-build live subscription acceptance are complete.

## Changed behavior

- `secrets.rs::CredentialStore` lazily caches desktop credentials in native
  process memory. Concurrent cold reads for an account share one store access.
  Successful persistence precedes reuse after rotation/replacement, deletion
  caches absence, failed writes evict stale cached values, and failed reads are
  retryable. Every new process returns to the OS store. API keys and subscription
  credentials stay in independent accounts; debug environment overrides retain
  their existing behavior. Mobile retains per-read protected-store policy.
- Opening ChatGPT Settings no longer triggers model discovery or decrypts the
  saved subscription credential. Check connection is explicit; successful login
  and explicit billing selection still refresh available models.
- Native owns the active login, progress, cancellation and transient browser URL.
  Leaving Settings releases only its polling view; returning reattaches. The UI
  shows browser/exchange/secure-save progress, offers browser reopening and Pi's
  pasted-callback fallback, and retains explicit reconnect and billing controls.
- The helper forwards only curated progress and routes optional manual input
  over private stdio. Pi's actual OAuth implementation still validates callback
  origin/state, exchanges codes, and refreshes tokens. Tokens never enter WebView
  state, history, logs or process arguments.
- Native test builds optionally sign and verify with `APPLE_SIGNING_IDENTITY`
  before pinning the executable hash. Ad-hoc signing is rejected as a configured
  stable identity. Release bundles retain Tauri signing/notarization.
- The gitignored `.gneauxghts-signing.local.json` can select a public certificate
  fingerprint without exporting its private key. `pnpm tauri dev` signs each
  executable before launch through Cargo's target runner and execs the app to
  preserve Tauri's process lifecycle. Local development configuration never
  supplies release signing credentials.

## Verification

- 42 support tests and 1,314 frontend tests across 153 files pass.
- All 14 Settings browser journeys pass, including login across navigation,
  cancellation, browser reopening, callback input, saved billing controls and
  zero model-discovery calls when reopening saved Settings.
- Six helper tests use Pi's real refresh and browser/callback implementations,
  synthetic token responses, actual loopback HTTP, both callback paths, state
  rejection, and cancellation releasing the fixed callback port. No real login
  credential is used by those tests.
- Four focused native credential tests pass, including 24 concurrent/repeated
  reads producing one cold load, account separation, fresh-process reload,
  rotation, removal, denied reads and failed writes. Native credential validation
  passes. All 19 native architecture fitness tests pass.
- `pnpm check` reports zero Svelte errors/warnings; E2E TypeScript and production
  web build pass. The build retains its existing large-chunk warning.
- The rebuilt native executable passes all three actual GPT-6 Luna subscription
  flows: reviewed walk edit, empty first-page cursor/pagination, reviewed note
  creation with a canonical citation. Existing stored subscription is used and
  billing remains `chatgpt`; disposable vault notes only. Reports are under
  `/private/tmp/chatgpt-signin-live/`. No extra permission question was required.
- Two further certificate-signed native builds each pass the same three actual
  GPT-6 Luna subscription flows, reusing the saved E2E subscription. Build A
  passes in 55.1 seconds; build B passes in 44.7 seconds. The user reported no
  credential dialog on A; B completed without another approval request. The
  executables have different SHA-256 and code-directory hashes but identical
  designated requirements. Build B uses nonincremental compilation to ensure
  different executable content, with no product-source changes for this probe.
  Reports: `/private/tmp/chatgpt-signin-signed-{a,b}/`.
- An actual disposable Cargo program validates the development target runner:
  certificate signing and verification succeed, an argument containing spaces
  reaches the executable unchanged, and exit status 43 reaches the caller.
- `git diff --check` passes.

Logs: `/private/tmp/chatgpt-signin-{tests,helper,check,build,browser,cache,fitness,native-build,live}.log`.
The initial sandboxed helper run could not bind loopback; it was rerun successfully
with loopback access. An initial browser-test fixture expectation was corrected
to match native cancellation and the actual single post-login discovery.

## Signing setup and scope

A native session cache removes redundant reads within a process; it cannot make
a different ad-hoc executable inherit Keychain trust. The user chose Xcode Apple
Development signing with a local-certificate fallback. They reauthenticated the
existing Personal Team, created the certificate and approved codesign access to
its private key. The new certificate is valid until 2027-10-19. Its public
fingerprint is selected in the gitignored local file; no private key is exported
and no Keychain ACL is broadened. The fallback was unnecessary.

The initial sandboxed identity lookup returned zero; an unrestricted lookup
found the new certificate and an older valid one. That first result did not
establish that the Mac lacked a usable identity. This was corrected to the user.

`pnpm tauri dev` and native test builds now use the configured identity; directly
invoking unsigned Cargo executables does not. Existing running development
sessions need to restart through the wrapper. Main-app and E2E credentials stay
separate, so the first signed main-app access can still require its own OS
approval. Release bundles retain their existing explicit signing/notarization
configuration. Apple's documented stable self-signed identity remains a local
development option without paid membership.

Signed-build evidence:

| Build | SHA-256 | Code-directory hash |
| --- | --- | --- |
| A | `325cccea9ff290752c49dc7185c8add38f8f41880ee4d31b67ff2e0460f83e42` | `c51314c3ca022505f5c1a0f20b0e70f7e0663d68` |
| B | `bce840c753eafab7991960b55a79643d14be2393b8ec84a2e711e7a25d87395f` | `828e0e00301f261301c0e6008251d82ed90fb973` |

The shared requirement uses the E2E app identifier and Apple's development
certificate chain and leaf identity. Its captured text is in
`/private/tmp/gneauxghts-signing-requirement.txt`. Signed-run logs and the second
build log are `/private/tmp/chatgpt-signin-signed-{a,b}.log` and
`/private/tmp/chatgpt-signin-signed-b-build.log`. Final support and production
build logs are `/private/tmp/chatgpt-signin-support-final.log` and
`/private/tmp/chatgpt-signin-build-final.log`.

Verified sources: [Apple's Keychain tracking and self-signed identity guidance](https://developer.apple.com/library/archive/technotes/tn2206/),
[Certificate Assistant](https://support.apple.com/guide/keychain-access/kyca8916/mac),
[Apple developer account comparison](https://developer.apple.com/help/account/basics/about-your-developer-account).

## Local-provider Settings follow-up — 2026-10-19

The user reported another main-app Keychain prompt after choosing Always Allow.
The earlier Settings acceptance covered ChatGPT but missed local-provider
discovery: `LocalModelSettings` fetched server models on mount, which read the
saved local API key. Opening AI Settings could therefore decrypt a credential.
Discovery now runs only on explicit Refresh; the saved model remains visible
without discovery. Explicit model selection/configuration retains its existing
capability lookup.

The running dev executable has a valid configured Apple Development signature.
A separate executable with the same designated requirement accessed the saved
local credential with dialogs disabled (OSStatus 0). This verifies current trust
across different executable contents; the reason the earlier Always Allow did
not persist remains unproven. No access-control rules were changed.

All 15 Settings browser journeys pass, including a new local-provider regression
covering opening/reopening Settings without discovery and explicit Refresh loading
models and capabilities. `pnpm check` and `git diff --check` pass. The running
development app was not restarted for this frontend-only change. Review found no
correctness or scope issues. Temporary diagnostics, logs and compiler cache were
removed after recording these results; the regression test remains.
