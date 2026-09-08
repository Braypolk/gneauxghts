---
status: accepted
---

# Verify the target Note Timeline before background coverage

After essential current-store admission and interrupted-work recovery, verify the Note Timeline required by an operation before admitting that operation; verify unrelated retained histories in the background. This deliberately permits a ready note to be saved while corruption in another note remains undiscovered, reducing startup blocking at the cost of later discovery. Once any corruption is discovered, the existing global block on new canonical publication applies.

## Consequences

- This changes the previous whole-vault-before-first-save attestation policy. It does not weaken [ADR 0006](0006-keep-history-preparation-mandatory-in-production.md): every app-owned save still prepares durable history before Markdown publication, and a blocked draft remains unsaved. No save-without-history mode or durable draft subsystem is introduced.
- Actual interrupted publications, deletions, observations, and surviving Editing Windows settle before conflicting ordinary work. Successful startup recovery is not rerun against live in-process intents. A note with extensive retained history may still take time proportional to that history before its first use.
- One private NoteTimeline runtime coordinates per-note verification and background coverage. A check observes one consistent store snapshot; only the same note's callers join it. Trusted mutations extend that proof. Clear, purge, and reset replace verification identity before changing retained history and prevent checks of an intervening replacement state from becoming usable proof. Obsolete failures are discarded as well as obsolete successes.
- Explicitly confirmed clear, purge, and reset replace or discard retained history. They need not reconstruct prose being discarded. Clear and purge require current-store admission/recovery and respect an already discovered corruption block; explicit reset is the recovery operation allowed to replace that unavailable or corrupt store and resolve the block. Their replacement guards invalidate old proof; a clear/reset rebuilds the current canonical baseline, and later publication must verify its target. This narrow discard rule never authorizes an unverified canonical publication.
- Current-Content Provenance and activity verify all consumed eligible Note Timelines while preserving their existing canonical-byte and current-content-generation checks. Workspace readiness is an observation of backend state, never a write permit or a second policy owner.
- Structural checks remain whole-store work and run in background or explicit diagnostics. Unavailable storage, cancellation, and I/O contention remain retryable; only proven corruption latches the global block. Coverage and completion are observable without launching a diagnostic scan.
- [ADR 0004](0004-treat-sqlite-as-the-first-note-timeline-store.md)'s clean-close portability boundary remains: stop new work, cancel background checks, drain admitted operations, settle durable work, checkpoint, and record the watermark. Portability does not require rereading every historical payload on each close. [ADR 0005](0005-remember-observed-history-generations-outside-the-vault.md)'s selected-store and rollback checks remain mandatory.

Adopted by explicit user choice in [issue 53](../../.scratch/note-timelines/issues/53-verify-active-note-before-background-history.md). Workspace bootstrap and save-readiness presentation follow in issue 54; final large-history and native acceptance follow in issue 55.
