# Local release Keychain prompt — 2026-10-27

## Finding

The installed `/Applications/Gneauxghts.app` and the original release bundle
were linker/ad-hoc signed, with no team identity and a designated requirement
containing only code hash `518daa6ca439e27c6089143a7428f19c9a3c34cb`.
The development executable used the configured Apple Development certificate
and the stable `com.braypolkinghorne.gneauxghts` identifier. The wrapper selected
the local certificate only for `dev`; ordinary `pnpm tauri build` did not inherit it.

Reinstallation retains app data and OS credentials. Startup's
`pi/runtime.ts::openPiChat` restores saved conversation models through
`nativeProvider.ts::registerModel` and `pi_chat_model_configuration`;
`pi_chat/transport.rs::configuration` resolves the provider credential. This
explains credential access before an explicit new chat request. No startup
runtime or credential storage policy was changed in this correction.

## Correction

`scripts/tauri.mjs` passes `macSigningEnvironment` to Tauri. Local `dev`, `build`
and `bundle` now inherit the configured local certificate. Explicit identities,
imported certificates, unsigned requests and notarization-required distribution
builds retain their own configuration. Tauri owns bundle signing; no credential
is migrated and no Keychain access-control rule is weakened.

## Validation and limits

- All 145 support tests pass, including local build/bundle selection and
  explicit/distribution signing isolation. The first sandboxed suite failed
  because temporary loopback listeners were denied; the unrestricted rerun passed.
- The existing release executable was rebundled through the repaired wrapper.
  System `codesign --verify --deep --strict` passes. Its designated requirement
  equals the development executable's requirement, independent of binary hash.
- A temporary native probe was signed and checked against that exact requirement.
  With Keychain interaction disabled, the local-provider credential returned
  OSStatus 0, the absent OpenAI API key returned -25300, and the existing ChatGPT
  credential returned -25293 (authorization failed). No credential bytes were
  printed or persisted. This is evidence that the ChatGPT item can still require
  a one-time approval for the stable identity, not proof of prompt-free startup.
- A replacement local installer is generated at
  `src-tauri/target/release/bundle/dmg/Gneauxghts_0.1.0_aarch64.dmg`. Its initial
  packaging run hit a busy temporary volume; after detaching that run's volume,
  the completed image was compressed with `hdiutil convert`. The image checksum
  and contained app signature are verified with a temporary read-only mount.
- This is a local Apple Development-signed app, not a notarized distribution.
  The installed `/Applications` copy was not replaced or restarted. Full startup
  after replacement and the user's Keychain approval remain unverified.
- JavaScript syntax checks and `git diff --check` pass.

Apple documents Keychain tracking by designated requirement in
[TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).
Tauri documents `APPLE_SIGNING_IDENTITY` and free-account local signing in
[macOS code signing](https://v2.tauri.app/distribute/sign/macos/).
