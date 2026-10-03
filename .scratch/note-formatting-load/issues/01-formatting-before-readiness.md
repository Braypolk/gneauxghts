# Note navigation exposes Markdown before the restored viewport is formatted

Status: needs-triage
Resolution: implemented (2026-10-02)

## Report

Opening a note sometimes shows raw Markdown, followed by formatting that changes
the layout and reading position. Investigation requested on 2026-10-02.

## Confirmed cause

`editorLifecycleController.ts` marks the editor ready immediately after creating
or swapping its CodeMirror view (lines 132 and 167). Neither path waits for
parsing, decoration publication, or restored-viewport measurement.

The installed `@codemirror/language` initializes parsing with a 20 ms work budget
and a 3,000-character initial viewport. Its remaining parse work runs later:
the requestIdleCallback path waits at least 100 ms, and the timer fallback waits
500 ms. Restoring a cursor farther down a note can reveal an unparsed viewport.

`markdownExtensions.ts:63` builds formatting from `syntaxTree(view.state)`, which
can be incomplete. The plugin correctly rebuilds when the background parser
publishes its tree. That eventual rebuild conceals Markdown markers and applies
heading, list, quote, and other styles, changing geometry after text is visible.
`NotepadPane.svelte` shows a loading badge but does not hide the editor content.

## Reproduction and evidence

The regression in `e2e/specs/browser/editor-formatting-load.spec.ts` uses the real browser app, production note
navigation and persisted cursor restoration, with the existing mocked backend:

1. Save a 220-section Markdown fixture into the browser harness Alpha note.
2. Navigate to Beta.
3. Store Alpha's cursor at heading 120, beyond the initial parse range.
4. Navigate back to Alpha and sample rendered lines each animation frame.

Run from the repository root:

```sh
pnpm exec wdio run e2e/wdio.browser.conf.ts --spec e2e/specs/browser/editor-formatting-load.spec.ts
```

Chrome 154 run on 2026-10-02:

| Time after navigation | Visible content | Scroll offset | Document height |
| --- | --- | --- | --- |
| 17–106 ms | Raw headings 115–120; no heading classes | 12,889 px | 25,244 px |
| 115 ms | Heading classes applied; markers concealed | 12,889 px | 25,617 px |
| 123 ms | Formatted headings 115–119 | 13,013.5 px | 25,617 px |

The loading badge was absent in all these frames. The viewport changed from six
raw headings to five formatted headings and moved 124.5 px. This confirms both
the raw-text flash and subsequent layout jump. This run reproduced about 100 ms
of raw content; the reported one-second duration was not measured on native WebKit.

Validation: browser diagnostic passed; all 28 existing Markdown unit tests passed.
The first sandboxed browser attempt could not bind localhost; the approved run
outside that restriction completed successfully. No application changes made.

## Proposed correction

Make initial note presentation and runtime swaps wait for formatting of the
actual restored viewport and its measurement before revealing the new document.
Use CodeMirror's supported bounded parsing/publication APIs and the existing
PaneEditorSession ordering; preserve stale-operation and disposal protections.
Avoid an arbitrary sleep or unbounded synchronous parsing of the entire note.
Keep a loading presentation while any necessary asynchronous parse completes.

Regression coverage should inspect the first visible frames on initial mount,
note swap, and reopening at a saved deep scroll/cursor position. Include a large
note and a delayed-parser case, and assert that new-note text is never exposed
without formatting and that the restored viewport does not jump afterward.

## Comments

Implemented on 2026-10-02 following the user's implementation request:

- Editor creation and runtime swaps stay loading while the serialized
  PaneEditorSession finishes presentation. Hidden content retains measurable
  layout, and readiness is no longer equated with mounting an EditorView.
- Bounded 12 ms CodeMirror parsing slices cover the actual restored viewport.
  Subsequent layout measurements and scroll/cursor positioning settle before
  reveal. A public geometry read flushes measurements even with suspended native
  frame callbacks; a timer fallback keeps cancellation and teardown moving.
- Restored cursor visibility is reapplied after formatting so increased heading
  heights cannot push the cursor below the viewport. Persisted scroll takes
  precedence when the reader left the cursor elsewhere.
- Document/controller/lifecycle guards prevent obsolete or disposed work from
  revealing a note; focus restoration runs after reveal.
- Permanent browser regressions assert no raw Markdown on any visible frame and
  stable screen positions for deep cursor restoration, independent saved scroll
  with a deliberately delayed idle parser, and note/chat/note remounts.
- Unit regressions cover loading readiness, obsolete documents, focus restoration,
  and disposal during mount or swap measurement.

The browser regression failed on visible raw headings before the fix and passed
afterward. Existing editor readiness and all 18 document/pane browser journeys
also passed. All 63 affected unit tests passed. Type checks passed with zero
errors/warnings after allowing the existing E2E inspection function to infer its
extra diagnostics while retaining the typed bridge assignment. Native WebKit was
not run directly; the idle
delay regression controls background scheduling while keeping the real parser.

Production frontend build passed. Local browser verification used an isolated
localhost port because another workspace test server was using the default port;
temporary diagnostic test/configuration files were removed.

## Follow-up: faster presentation (2026-10-02)

The user reported that the formatting fix added a noticeable pause and briefly
showed `Loading editor`. The settling loop required at least six animation
frames, including for an already parsed and stable note.

Measured navigation-to-first-visible-content using the same real-app browser
fixtures, before and after replacing repeated frame waits with supported
synchronous CodeMirror geometry reads:

| Scenario | Repeated waits | Direct layout settling |
| --- | --- | --- |
| Deep cursor | 58.5 ms | 24.1 ms |
| Saved scroll with idle parser delayed | 101.6 ms | 24.4 ms |
| Chat-to-note remount | 92.7 ms | 19.7 ms |

One initial frame admits the mounted shell's measured chrome inset. Parsing,
decoration publication, viewport measurement and scroll restoration then converge
within bounded work slices. Changed geometry retries immediately while time
remains; expensive parsing still yields. Readiness requires a parsed viewport,
reached scroll target and unchanged measured geometry across the parse/measure
pass. Cancellation and suspended-native-frame fallback remain intact.

The loading label now appears only after 150 ms. Its timer controls presentation
feedback without owning readiness or delaying the actual reveal. The short-note
browser regression failed on a visible loading label before this change, then
passed. Short-note reveal measured 7.5 ms; the final long-note confirmation
measured 19.4–27.3 ms and retained formatting and stable reading positions.
Browser helpers now wait for `aria-busy="false"`, since an absent loading label
no longer implies readiness. Temporary timing instrumentation was removed.

Validation: 67 affected unit tests passed; the four presentation browser checks,
editor-readiness journey, and 17 document/pane journeys passed. The hold-to-Forget
browser check timed out, including when repeated frame waits and the immediate
loading label were reinstated; that unrelated behavior was left unchanged.
Type checks passed with zero errors/warnings, and the production frontend build
passed. Native WebKit was not run directly.
