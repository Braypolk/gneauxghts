# iOS device release gate

Status: ready-for-agent
Priority: P1 release

## Scope

Establish an iOS simulator/device smoke workflow, then validate recent physical iPhones: keyboard/rotation/safe areas, selection/IME, VoiceOver/text scaling, attachments, vault switching, credentials, background/lock/kill/resume, and representative vault performance.

Compile the native mobile suspension branch and validate the [implemented background save handling](../../archive/mobile-background-saving.md). The initial implementation was checked with the macOS Rust target and browser fixtures only.

## Acceptance

Browser fixture tests do not establish WKWebView, native SQLite recovery, process memory or actual iOS suspension guarantees. Record device/OS, build and observed results before calling the app iOS-ready.
