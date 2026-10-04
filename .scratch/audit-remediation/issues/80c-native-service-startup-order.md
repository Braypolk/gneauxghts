# Serialize native launcher after owned Vite admission

Status: ready-for-agent
Progress: complete
Owner: audit_timeline

## Evidence

Root native acceptance: app lifecycle first run passed three cases; subsequent timeline run had no IPC after 30 seconds and URL about:blank. Installed WDIO runServiceHook invokes separate services concurrently with Promise.all, so NativeServerAdmission and the Tauri launcher race. Starting a custom class service before the package service in the array is not an ordering guarantee.

## Plan before edits

Replace the two launcher services with one absolute-path module service. Re-export the Tauri worker service unchanged and subclass its launcher. Await owned Vite admission before invoking the inherited onPrepare; retain fatal admission errors and cleanup both partial app launch and creator fixture on failure. Remove config cleanup: installed WDIO invokes config.onComplete before service onComplete, so only the adapter can enforce app-stop before Vite-stop and fixture removal. Move the readiness guard to a Mocha root hook, whose rejection actually fails the suite. Add small adapter-order/failure regressions against the real launcher superclass method seam; run support tests and E2E types, then freeze for root native acceptance.

## Acceptance

No Tauri launch before admission resolves; admission rejection never launches; failure is SevereServiceError with cleanup; worker service export retained; cleanup idempotent. Root owns real native verification.

Additional evidence: installed WDIO cli runOnCompleteHook invokes config.onComplete before launcher-service onComplete. The adapter exclusively owns ordered app/server/fixture completion, including failed preparation; config cleanup removed to prevent deleting a live app’s fixture.

## Outcome

Single path-based service adapter implements ordered admission and teardown, retains worker service, and makes preparation/cleanup errors fatal. Mocha root hook now owns IPC readiness. Four focused adapter tests, E2E TypeScript check and adapter syntax checks passed. Source frozen for root native acceptance. See ../harness-review.md for integration evidence and limits.

Combined support suite after adapter changes: 28/28 passed (~2.7s); scoped diff check passed.
