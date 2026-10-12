# iOS readiness implementation plan

Target recent iPhones with desktop feature parity. Prefer on-device embeddings and AI, subject to measured memory and responsiveness. Desktop/phone sync, sharing and older-device compatibility are deferred. Preserve the current mobile visual work.

## Priority order

| Order | Work | State |
| --- | --- | --- |
| 1 | [P1: Background save safety](../archive/mobile-background-saving.md) | Implemented; device validation pending in 08 |
| 2 | [P1: iOS vault switching](issues/02-ios-vault-switching.md) | Planned |
| 3 | [P1: Cancelled block drags](issues/03-cancelled-block-drags.md) | Planned |
| 4 | [P2: Touch editing actions](issues/04-touch-editing-actions.md) | Planned |
| 5 | [P2: Secondary touch controls and image gestures](issues/05-secondary-touch-controls.md) | Planned |
| 6 | [P1 parity: On device semantic runtime](issues/06-on-device-semantic-runtime.md) | Planned |
| 7 | [P2 parity: On device chat](issues/07-on-device-chat.md) | Planned |
| 8 | [P1 release: iOS device release gate](issues/08-ios-device-release-gate.md) | Planned |

Safety work comes first: background saves, vault switching and cancelled gestures. Touch workflows follow. On-device semantic and chat work require separate feasibility measurements; the device release gate applies throughout.

## First implementation

Use the existing workspace and composer persistence owners. Native suspension and browser background signals request saves before debounce timers fire, without introducing a second canonical write path or closing the Running Vault. Ordinary documents save independently; unresolved conflicts and protected proposal reviews are never overwritten. Keep failed text dirty/retryable and join in-flight writes.

This improves background admission; it cannot guarantee completion if iOS suspends or kills the process before IPC and durable writes finish. Physical-device background, lock and termination checks remain explicit release work.

Implementation is complete with 66 focused unit tests and 11 mounted browser tests passing. Svelte/E2E type checks and the host Rust check pass. The mobile Rust branch and real iPhone lifecycle behavior remain unverified; see the [implementation record](../archive/mobile-background-saving.md). The next implementation priority is iOS vault switching.

## Evidence

The audit passed 32 existing responsive/navigation/sizing checks. Three temporary browser probes reproduced cancelled-drag mutation, plain link taps revealing source and chat Return interception. No physical iPhone validation was performed during the audit. This plan separates reproduced defects from platform risks and feasibility work.
