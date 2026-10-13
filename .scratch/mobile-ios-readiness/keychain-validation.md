# iOS simulator Keychain validation

2026-10-11: Both provider credentials now pass actual-app Keychain save, read, replacement, deletion and relaunch checks. Xcode's normal simulator signing fixes the earlier test-package failure. No production credential code, entitlements file or Keychain accessibility policy was changed.

## Cause and build

The earlier package was built with `--no-sign`. Later manual signing could make it runnable, but could not restore Xcode's embedded simulator application identity. Putting device-style entitlements into its ad-hoc signature caused AMFI rejection; using a development identity demanded a profile. Those failed experiments did not establish that the simulator needed device provisioning.

Xcode's actual simulator build settings are `PROVISIONING_PROFILE_REQUIRED = NO`, `ENTITLEMENTS_DESTINATION = __entitlements`, `CODE_SIGN_INJECT_BASE_ENTITLEMENTS = YES`. A normal build generates a simulated entitlement containing `application-identifier = 6ZTMQAJ826.com.braypolkinghorne.gneauxghts`, embeds it in `__TEXT,__entitlements` and `__TEXT,__ents_der`, and signs for “Sign to Run Locally”. Its signature entitlements are empty; the simulated entitlement lives in the executable. Both fixture and ordinary app bundles pass `codesign --verify --deep --strict` and launch without manual resigning. This is Xcode's simulator signing path, not a newly created physical-device provisioning profile.

Apple describes how Xcode combines build settings and app entitlements in [Entitlements](https://developer.apple.com/documentation/bundleresources/entitlements); the specific simulator findings above come from the local build settings, linker invocations and executable inspection.

Environment: Xcode 26.4.1 (17E202), iPhone 17 Pro simulator running iOS 26.4.1 (23E254a), disposable `Gneauxghts Semantic Test` (`3E6C179B-10D5-4FA2-8773-207EB27951BF`). Ordinary feature-off executable SHA-256: `623a9e1f17ed63ad8580f1928db69a2e701799ea79a302c7ac1f5e14863d3f76`.

Build normally, omitting `--no-sign`:

```sh
pnpm tauri ios build --debug --target aarch64-sim --ci
```

For the bounded OpenAI protocol check, add `--features e2e-chat-fixture`. `GNEAUXGHTS_IOS_LITERT_ARCHIVE` can point at an already verified official runtime ZIP for offline reuse. The final installed app is the ordinary feature-off build, launched without any test environment overrides.

## Actual app observations

The native commands below use the production `secrets.rs` owner and iOS Keychain plugin. They were exercised through Safari Web Inspector → WKWebView → Tauri IPC. No direct Keychain database editing, plaintext fallback or secret-returning IPC was introduced. Keys were fake and existed only in the disposable simulator. Neither `OPENAI_API_KEY` nor `GNEAUXGHTS_LOCAL_API_KEY` overrides were supplied for these launches.

| Check | Compatible server | OpenAI |
| --- | --- | --- |
| Initially absent | `configured: false` | `configured: false` |
| Save with `chat_set_api_key`, inspect with `chat_get_key_status` | True | True |
| Model discovery with exact stored token | 2 fixture models | 1 allowed fixture model |
| Terminate/relaunch, inspect saved status | True | True |
| Chat after relaunch authenticates with exact stored token | Complete | Complete |
| Replace token, require replacement in fixture | Discovery passes | Discovery and chat pass |
| Reject old stored value before replacement | Not separately checked | HTTP 401, then success after replacement |
| Delete provider credential | False; server rejects no-key request with 401 | False; discovery says “Add an OpenAI API key in Settings” |
| Provider isolation | Replacing/deleting server key leaves OpenAI working | Unchanged until explicitly replaced/deleted |

After a full simulator shutdown/boot, the deleted server credential remained absent and the replaced OpenAI credential remained configured and authenticated model discovery. OpenAI was then deleted. Installing the ordinary feature-off build preserved both deletions. Both credentials were also saved afresh in that ordinary build, survived another process relaunch, and were deleted through the app. All synthetic credentials were removed at the end.

The exact-token fixture uses distinct loopback paths `/local/v1` and `/openai/v1`. A 401 is returned unless the Authorization header exactly matches the current fake token for that prefix. Success therefore establishes the stored value was read, not merely that a configured-status flag survived. Rotation changes the expected fixture token before replacing the Keychain value. The server logs only whether Authorization is present; its log contains no fake token strings. No live OpenAI request or real server credential was used.

Safari eager evaluation produced extra synthetic read/chat calls when entering expressions such as `(await kcChat(...)).status`. These were read-only fixture conversations, not mutation scenarios; request counts from this run are not an exactly-once claim. Later phases assign awaited results to variables before inspecting properties, and invoke separately defined functions with `void functionName()`.

## Fixture reproduction

The retained [protocol fixture](remote-chat-fixture.py) accepts optional `--auth-file`, a JSON mapping URL prefixes to expected synthetic tokens. For example, a temporary file can contain:

```json
{"/local/":"synthetic-server-token","/openai/":"synthetic-openai-token"}
```

```sh
python3 -B .scratch/mobile-ios-readiness/remote-chat-fixture.py \
  --log /private/tmp/ios-keychain-requests.jsonl \
  --auth-file /private/tmp/ios-keychain-auth.json
```

Set the app's compatible endpoint to `http://127.0.0.1:18440/local/v1`. For an opt-in debug fixture build, launch with `SIMCTL_CHILD_GNEAUXGHTS_OPENAI_FIXTURE_URL=http://127.0.0.1:18440/openai/v1`. Do not supply credential environment overrides. Save the corresponding fake values through `chat_set_api_key` or Chat Settings, discover models, and send `IOS_STREAM`. Terminate/relaunch and repeat before replacing/deleting the keys. The auth file is reread per request to support rotation without restarting the fixture.

## Remaining boundary

This closes the simulator Keychain blocker. Physical device/distribution provisioning, locked-device accessibility, actual suspension, backup/restore behavior, live providers and networking remain in [issue 08](issues/08-ios-device-release-gate.md). The app retains `WhenUnlockedThisDeviceOnly`; simulator persistence does not establish locked-device behavior or distribution acceptance.

Logs and signed test artifacts are local under `/private/tmp/gneauxghts-ios-remote-chat/`. Product Rust code was unchanged in this follow-up; two native builds, signature/executable checks, fixture syntax validation and the actual Keychain journeys provide the relevant verification.
