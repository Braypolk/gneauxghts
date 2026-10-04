# Browser/native/support audit

Progress: audited; proposed edits await the full audit checkpoint.

## Accepted removals

| Case | Reason and surviving owner |
| --- | --- |
| native/app-lifecycle.spec.ts: `boots the real application through the embedded macOS driver` | The immediately following driver-reconnection case already drives the live window and waits for the real workspace shell. Every native journey also requires the native bridge in the config root hook. The remaining distinct assertion is the static app title; this does not warrant a dedicated boot test. Delete the whole case, without moving its title assertion. |
| browser/pane-animation.spec.ts: `keeps the new pane layout stable during open` (one generated case) | Four narrow/wide × left/right cases already execute the identical `samplePaneMotion('open')`, `expectContinuousMotion` and `expectStableEntrance` sequence, plus final pane count and closing behavior. Drop only `open` from the initial action list; retain direct `open-current` and `open-chat`, which use different quick-choice entry paths. |

Two actual redundant scenarios removed; no case merging, disabled cases or assertion relocation. Expected native smoke13→12, browser cases−1, file counts unchanged.

## Retained overlaps and why

- Browser/native images and pane/chat motion exercise Chromium versus actual WKWebView, assets/IPC and native focus. They are not interchangeable despite shared assertions.
- Native bridge presence is debug plugin packaging coverage, not equivalent to normal Tauri IPC readiness; keep the dedicated bridge case.
- Browser readiness repeatedly switches through focus/visibility/keyboard events; document-lifetime switching uses the recent-note controls and exact body isolation. Different mounted entry paths and exact-text assertions justify both.
- History settings purge confirmation versus ordinary settings purge cancellation cover opposite outcomes. Browsing naming, stale comparison naming and keyboard focus are distinct contracts. Keep them.
- Cursor/code/table/range tests require actual geometry. Pure CodeMirror tests cannot replace these. Narrow/wide layout and left/right closing exercise separate anchoring constraints; retain boundary combinations.
- Opt-in provider journeys ask different evidence/research/date/follow-up questions and record model-dependent artifacts; they do not inflate the ordinary deterministic gate. They are not replaced by fixture unit tests.
- Support32 and Python8 cover fixture ownership/containment, distinct startup failure stages, cancellation, bounded IPC transport and validation of immutable evidence. Similar cleanup assertions apply to independent resource owners and failure stages. No defensible duplicate removal found. Production fixture helpers were inspected alongside these tests.
- Avoid shortening stress loops merely to lower runtime without evidence of the iteration at which a regression appears. They are reported as one case regardless and are not the source of the suite's large case count.

## Verification

Run affected browser pane-animation and native app-lifecycle specs after deletions; run full support and typechecks as combined gates. No application source changes and no native binary rebuild necessary for test-only edits.

## Implementation

Approved two cuts applied: native boot-only case removed, redundant plain-open member removed from the first browser pane-motion loop. All remaining assertions and fixtures unchanged. No support/production changes. Verification follows after parallel edits/compilation settle so graphical timings are uncontended.


Final verification:browser pane-animation10/10 and native app-lifecycle2/2 passed; logs browser-pane.log and native-lifecycle.log. Exactly2 cases removed,6 net source lines, no source files removed.
