# Bound remaining browser animation samplers

Status: ready-for-agent
Progress: implementation and serialized browser acceptance passed
Owner: audit_agent
Findings: EH-09 remaining browser samplers

## Plan before edits

Window-resize currently waits indefinitely for resize event/frame delivery; border/interrupt/collapse samplers check deadlines only inside rAF callbacks. Add independent wall-clock timers, exactly-once completion and cancellation of pending rAF/listeners on success/failure. Replace generic400ms readiness and500ms border/resize observation with explicit finite-animation/motion settling plus sufficient observation frames; preserve border drift, interruption phase, endpoint, no-stale-animation and resizing assertions. Keep forget-fill500ms sampling because its timing is the assertion under test. Own only window-resize, pane-animation and animation-cleanup plus a shared narrow readiness helper; documents agent owns other specs.

## Validation

Run pnpm check:e2e. Do not run browser concurrently: hand these three specs to root for serialized targeted browser verification. Root native build unaffected by these test-only changes.

2026-10-03 scope extension before edit: root also assigned editor-route-layout's rAF-only elapsed guard. Add independent timeout/cancellation and observe rendered editor plus finite-animation settling, retaining all first-visible geometry samples and drift assertions.

## Outcome and validation handoff

Implemented independent3–5second wall-clock timers and exactly-once cleanup for resize event/rAF, active-border entrance, pane-close interruption, retargeted collapse/entrance, and editor-route layout. Resize teardown removes its listener, cancels queued frames, clears its deadline and clears global cancellation ownership even if setWindowSize fails. Other samplers cancel the current frame and timer on success/failure. State settlement observes finite animations/pane motion plus sufficient frames, preserving all original drift/phase/width assertions. Shared waitForWorkspaceAnimationSettled replaces generic400ms readiness waits. The forget-fill500ms measurement remains deliberate because elapsed progress is its subject.

pnpm check:e2e passed after the first three specs. After adding editor-route-layout, check:e2e reports no errors in these four specs/helper but concurrent native command-events changes introduce Window cast and imported Svelte rune/$app type errors; root notified to finish that independent change. Owned diff --check passed. Browser not launched in parallel; root will run window-resize, pane-animation, animation-cleanup and editor-route-layout after documents agent releases its session.

Read-only additional-loop inventory sent root: chat-pane history interruption still has rAF-only deadline; documents owns animation-navigation double-frame restore risk; opt-in native editing-windows continuous sampler is meaningful measurement but only stops on success, and per-input timer lacks once-only/cancel cleanup. timelineNativeMetrics has independent timeout/finish guard but leaves nested pending frames. Native chat-typing and several simple cursor/selection/image double-frame yields rely on outer WebDriver timeout. No changes made to these separately owned files.

2026-10-03 root scope extension before edits: bound chat-pane-animation's remaining closeWhenRendering loop. Replace plain double-rAF yields in image-interactions, selection-menu and editor-cursor with one serialized browser-safe shared helper; preserve two actual animation frames and cancel pending callbacks on timeout. Documents owns animation-navigation; UI owner handles native measurement loops. Root runs modified browser specs serially.

## Final browser extension handoff

Implemented chat-pane closeWhenRendering independent5second timeout, exactly-once completion and frame cancellation. One browser-serialized, closure-free sampleTwoAnimationFrames function now backs eight two-frame yields across image-interactions(1), selection-menu(2), editor-cursor(5). Its timeout cancels whichever frame is pending; successful completion still requires both frames. No test actions/assertions were removed.

Latest pnpm check:e2e PASSED across the complete E2E project after concurrent native types settled. Owned diff --check PASSED. Root serialized browser acceptance pending for the original four plus chat-pane-animation, image-interactions, selection-menu and editor-cursor. Documents and UI owners retain their separate browser/native cleanup scopes; no blanket all-loop closure is claimed here.

## Retarget geometry diagnosis

Root serialized run:9other files passed; animation-cleanup retarget entrance observed52.7421875px across a single frame against <35px. Deadline changes leave before/click/next-frame ordering intact; readiness changed from400ms delay to finite animation state. Competing explanations: actual discontinuity in replacement start vs ordinary progress across a slow frame. Probe before/after timestamps, old/new width keyframes/currentTime, and replacement origin. Do not increase threshold without evidence. Browser reproduction waits for root native-focus slot.

### Diagnosis and closure

Natural probe: before557.8203125px, replacement origin557.82px, next paint530.03125px after33.1ms; old threshold happened to pass. Controlled100ms phase probe: before630.21875px, replacement origin630.219px, next paint561.90625px after33ms; old threshold failed at68.3125px despite0.00025px origin continuity. This confirms a stale frame-rate-dependent test oracle, not a production retarget jump. Evidence in measurements/retarget-geometry.json and retained probe logs.

Final test pauses/seeks the real original width animation halfway, invokes real Related click, asserts replacement identity and active motion, origin continuity within1px, a destination over35px away (non-vacuous snap detector), and actual next paint strictly between start and endpoint. Removed all temporary diagnostic logging; no app change. Full animation-cleanup8passed in8.3s and check:e2e passed. Root reported the other9 browser files/60tests passed in its preceding serialized run. Browser focus released to root for final suite checks.
