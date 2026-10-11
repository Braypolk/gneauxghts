# Native citation reproduction — 2026-10-10

The full native chat path reproduced a malformed reference and exposed an
excerpt-only scope failure. Of three completed answers, one passes the manual
full-answer rubric. A fourth request returned Flex unavailability without usage;
no paid retry was made. Production instructions and rendering behavior remain
unchanged. The only correction in this phase is to the native test harness's
failure-status handling.

## Native method

Built a fresh pinned debug E2E app (SHA-256
`a278f72f51566bd6fb0d20594d464b433b633f4514e29c7296c1833489a10c8c`).
The real native WebKit app used production `chat_send_message` IPC, runtime,
all five tool definitions, unchanged core instructions, canonical source
admission and final reference rendering. The selected settings were saved
OpenAI `gpt-6-luna`, medium reasoning and Flex, verified in the disposable app.
The launcher reads the existing Keychain credential into process memory and
child environment; no credential is sent through WebDriver or saved in artifacts.
User notes and preferences were not changed.

The disposable vault held two notes. The deadline body is unchanged from the
synthetic inventory. Its question explicitly requests every checkbox, including
completed work, and evaluates September 30, 2026; no runtime clock was mocked.
The deadline rubric compares the currently recorded checkbox statuses against
that fixed calendar date; it does not establish actual historical task state on
September 30. Future repeats should say this explicitly if testing calendar
comparison rather than historical status. The retrospective contains the selected sentence “Deployment approval was
discussed.” followed by “Jordan approved deployment.” Each question starts a
fresh conversation with a canonical editor identity hint. Both retrospective
questions also attach the first sentence through the real selected-context path.
Neither question requests a particular citation format.

Lexical-only retrieval keeps this a context/source test; semantic relevance is
not measured. These are production command submissions in a real native app,
not composer interactions. No visual citation click was performed. Passage
resolution was exercised for every actual inline link; rendered text is the
app's final stored message. Raw text-delta events preserve the model's reference
spelling. Private reasoning and tool arguments/payload transcripts are not captured.

The four planned questions were bounded to four model requests, six tool calls,
24,000 reported tokens and 120 seconds per answer, with cancellation when
observed. These are observational ceilings; in-flight usage can arrive late.
No tier switch, automatic rerun or question-specific app behavior was introduced.

## Outcomes

| Native case | Outcome |
| --- | --- |
| Deadline 1 | All four checkboxes and fenced example classified correctly, but the model ends with literal `【S2】`; no usable inline links |
| Excerpt only | Fails requested scope: reads the whole note, then claims Jordan is named “Using only the selected excerpt”; body citation resolves but does not support that excerpt attribution |
| Unrestricted named-note question | Pass: recovers from one unknown-evidence-ID error, reads the full body and correctly names/cites Jordan |
| Deadline 2 | Provider returns `flex_unavailable`; no answer and no reported usage; retained separately from semantic grading |

The deadline raw and rendered strings are identical, including `【S2】`.
The issued reference interface uses `[S#]`; the Markdown reference renderer
recognizes that syntax, not the model's alternate brackets. Valid references in
both retrospective answers convert faithfully to the exact delivered body
passage and resolve successfully. This is a demonstrated native malformed-marker
case, not proof of the cause of older omissions without raw captures. No valid
reference was observed being deleted.

The excerpt-only answer is:

> Yes. Using only the selected excerpt, **Meridian retrospective names Jordan**: “Jordan approved deployment.”

Jordan occurs outside the selected sentence. The full note was permitted, so
this is a requested answer-scope/attribution failure, not a vault permission
bypass. By contrast, the unrestricted companion may legitimately inspect the
full note. It does so and answers correctly. An implicit selection lock would
break that useful behavior.

Manual grading covers 11 note claims: two supported, one unsupported excerpt
attribution, eight unassessable because the malformed deadline marker supplies
no usable citation. All required deadline content is correct. One of three
complete answers passes; this selected sample is not a general reliability rate
or a paired before/after prompt improvement. The native questions clarify coverage
and introduce a real selection/full-note boundary, so they are not identical to
the earlier fixed-evidence synthesis cases. The original partial-read omission
of a bounded excerpt assertion did not recur here: the model instead obtained
a full canonical read. Its original no-full-note uncertainty branch is therefore
not established as fixed by this run.

## Test-harness failure and correction

Production persists provider failures with message status `error`. The new probe
and existing shared wait helper only recognized `complete`, `failed` and
`cancelled`. For Deadline 2, the runtime closed its provider attempt after about
6.2 seconds with unreported usage; the harness kept polling until 120 seconds,
then tried to cancel an already ended request. “That chat request is no longer
active” masked the provider failure as the structural test error.

The shared terminal-status helper now includes `error`; the shared wait path
and new probe use it. The new probe also preserves cancellation-race diagnostics
without replacing the original failure. Four focused artifact/helper tests and
the E2E TypeScript check pass. This repair was verified offline, with no paid
native rerun. The original failed run/log and the exact pre-repair spec/helper
snapshots are retained. Do not present the original native gate as passed.

This demonstrates a harness-induced wait in this run. It does not diagnose the
earlier five-minute local request in issue 06. Normal completed answer latency
here was 25.7, 4.7 and 7.1 seconds; observed read-tool durations were 4–15 ms.
Those values do not isolate every app/UI cost or establish local-model speed.

## Reported usage

| Completed native answer | Model requests | Input | Output | Total | Cached input | Reasoning |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Deadline 1 | 2 | 5,940 | 529 | 6,469 | 2,314 | 245 |
| Excerpt only | 2 | 5,628 | 68 | 5,696 | 2,375 | 0 |
| Unrestricted | 3 | 8,132 | 100 | 8,232 | 6,806 | 9 |
| Complete-answer total | 7 | 19,700 | 697 | **20,397** | 11,495 | 254 |

The fourth, failed request has one observed model attempt and unknown usage;
20,397 is the reported complete-answer total, not a known all-attempt bill.
Cached tokens are included in input and reasoning in output. No title generation
request was needed for the explicitly named test conversations.

## Evidence and checks

- [Native runtime](native-runtime.json) and [original execution log](native-runtime.log), including all failures.
- [Manual review](native-review.json), [grade](native-grade.json), [review corpus](native-fixtures.json) and [exact answers](native-answers.json). Review origins bind the final runtime file SHA-256/result index. The review corpus is a post-run snapshot, not model generation input.
- [Pre-run provenance and post-run repair hashes](native-provenance.json), [exact run spec](native-spec-at-run.ts), [exact shared helper at run](native-helper-at-run.ts), [build log](native-build.log).
- [Native probe](../../../e2e/specs/native/citation-reliability.spec.ts) and [explicit launcher](../../../e2e/support/citationReliabilityNative.mjs). The default suite skips the probe; `--run`, a settings snapshot and a fresh output are mandatory. `--case` selects only unfinished cases if a future authorized retry is useful.
- [Focused harness tests](native-harness-checks.log), [TypeScript check](native-types-final.log), [full support checks](native-support-checks-unsandboxed.log), [artifact integrity](native-artifact-checks.log). The first full support run hit sandbox loopback bind restrictions; the permitted rerun supplies the actual test result.

All observed tool calls were `read_notes`; no note-change tool ran. The provider
failure skipped the final aggregate canonical-byte assertion in the test. All
fixture note files were removed by native-suite cleanup, verified afterward.
No production Rust, shared instruction or renderer file changed in this phase.

## Next correction

Track the excerpt constraint in [context issue 09](../../chat-context-selection/issues/09-selection-only-answer-scope.md).
First inspect whether attached selected context exposes a precise, canonical
answer-read selector: it currently supplies readable text and a legacy note
source, while admitted passage references come from the subsequent read.
The full-body read and recovered unknown-ID error are observed; why the model
ignored the explicit constraint and which argument was invalid remain unknown.
A focused context/read seam correction should preserve ordinary unrestricted
reads and avoid increasing the core prompt without evidence.

Separately, investigate narrow handling of the observed alternate reference
spelling under the existing issued-and-delivered source checks. Recognizing a
known reference format cannot repair wholly missing references or infer claim
support. Preserve code/examples and unknown-source behavior. There is no basis
here for automatic source appending or a verifier-model call per answer.
