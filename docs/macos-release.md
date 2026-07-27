# macOS Release

Use this flow for DMGs that should open on clean Apple Silicon Macs without Homebrew or user configuration.

## Requirements

- Paid Apple Developer account.
- `Developer ID Application` certificate installed in Keychain, or exported as `.p12` for CI.
- Apple notarization credentials.

Unsigned or ad-hoc signed DMGs can show macOS errors like "app is damaged and can't be opened" after download or transfer. That is Gatekeeper rejecting distribution signing, not a semantic-model error.

## Local Release Build

Find signing identities:

```sh
security find-identity -v -p codesigning
```

Set signing identity:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
```

Set notarization credentials with App Store Connect API:

```sh
export APPLE_API_ISSUER="issuer-uuid"
export APPLE_API_KEY="key-id"
export APPLE_API_KEY_PATH="/absolute/path/AuthKey_KEYID.p8"
```

Or use Apple ID notarization:

```sh
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

Build and verify:

```sh
pnpm run release:mac
```

The release script refuses to run without signing and notarization credentials. After Tauri builds, it runs:

```sh
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/Gneauxghts.app
spctl -a -vvv -t exec src-tauri/target/release/bundle/macos/Gneauxghts.app
spctl -a -vvv -t install src-tauri/target/release/bundle/dmg/Gneauxghts_*.dmg
```

Only distribute the DMG if those checks pass.

## Keychain Identity

Gneauxghts stores user-provided API keys in macOS Keychain under the service
`com.braypolkinghorne.gneauxghts.credentials`. Opening AI Settings checks only
Keychain item metadata; it does not decrypt the saved key. macOS can still ask
for permission when chat actually uses the key.

Use a consistently signed app bundle when testing Keychain access. Rebuilding
and running the unsigned `target/debug/gneauxghts` executable gives macOS an
unstable code identity, so a prior **Always Allow** decision may not carry over.
With an Apple Development identity installed, build a signed debug app:

```sh
export APPLE_SIGNING_IDENTITY="Apple Development: Your Name (TEAMID)"
pnpm tauri build --debug --bundles app
open src-tauri/target/debug/bundle/macos/Gneauxghts.app
```

Release builds must continue to use the Developer ID flow above. Keep the bundle
identifier and signing team stable between releases so existing Keychain access
decisions remain valid.

The current macOS backend uses the Login Keychain for compatibility with direct
Developer ID distribution. Moving existing credentials to the Data Protection
Keychain is a separate migration: it requires an appropriately provisioned app,
entitlements/access-group decisions, and a tested copy-then-delete migration.
Do not change backends without that migration or existing users can appear to
lose their saved key.

## Developer-Only Bypass

For a one-off test of an unsigned build on another Mac:

```sh
xattr -dr com.apple.quarantine /Applications/Gneauxghts.app
```

Do not use that for distribution. It only bypasses quarantine on that machine.
