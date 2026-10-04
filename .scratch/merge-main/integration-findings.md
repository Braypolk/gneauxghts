# Integration findings before conflict corrections

1. Main's browser fixture adds Atlas responses and event emission, while cleanup
   already supplies owned listener cleanup and a single shared bridge contract.
   Keep main's setAtlas ability in the existing contract and retain cleanup's
   listener lifecycle and explicit unsupported-command errors. Do not restore
   duplicate global declarations or a second listener registry.
2. Atlas lab main changes moved the demo and removed prototype comparison UI.
   Keep these changes with cleanup's explicit command override seam; do not restore
   source-string rewriting of browserBackend or the removed comparison badge.
3. Main's new AtlasNode activity field must follow the cleanup's extracted build
   and test modules. A whole-file choice would silently lose either the field or
   the extraction. Dedicated reviewer owns this reconciliation.
4. Main's initialization/search race fixes overlap cleanup's broader lifetime and
   invalidation implementation. Preserve the deeper owner and bring distinct new
   scenarios into its existing suites, rather than retaining parallel counters.
5. Notepad's native contract-probe and Open File Location imports are independent;
   retain both. Date-feature edits are explicitly authorized for inclusion and
   will be checked against the integrated test expectations.
6. Fusion removes the last production Deck renderer. Repository-wide import scan
   finds only the obsolete map-animation test bridge using @deck.gl. Once the new
   public renderer journey replaces that case, remove browserModules.ts and the
   unused direct Deck dependencies instead of carrying dead test infrastructure.


## Browser evidence and correction

The first frozen full run passed 25/26 files. Its first map case failed after
changing the double-click target from default Alpha to nondefault Beta. A bounded
headless hit-test diagnostic established Beta's center at (1400,468.5) was covered
by the floating reader ARTICLE: elementFromPoint returned reader=true, node=null.
This is an invalid test target, not evidence of a broken navigation handler.

Correct setup uses real workspace navigation to establish Beta as the open note,
returns to Map via SPA navigation (preserving backend/workspace state), selects
Beta, and double-clicks the visible left-hand Alpha. It explicitly checks Beta is
the current backend note before clicking, then requires the actual editor Alpha.
Thus clicked differs from selected and preexisting note; default-note fallback
cannot satisfy the assertion. No synthetic click, timeout increase or product
change. The temporary hit-test assertion is removed from live test discovery.

The next complete run passed Atlas but failed startup-readiness after a 15-minute
host sleep. macOS power logs show sleep at 2026-10-04 00:59:21 -0600 and wake at
01:14:22; WebDriver's UND_ERR_CLOSED is timestamped 07:14:22Z immediately on wake.
The browser log's total elapsed time was 17m56s. No product or test correction is
justified by a suspended host. Preserve browser-final.log and power-events.log;
validate unchanged source under a command-scoped caffeinate -is assertion on AC.
This changes neither display wake behavior nor persistent power settings, and
adds no test retries, timeout changes or default-suite configuration.
