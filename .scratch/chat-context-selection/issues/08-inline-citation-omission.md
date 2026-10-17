# Investigate an answer delivered without an inline passage citation

Status: wontfix
Type: bug
Resolution: open

The second native referent replay correctly selected and reread the updated
production note, then answered an explicit topic change from **Cedar afternoon**
without any inline passage link. The delivered answer correctly gives beside
the lake at 13:30 and notes that the note has no date or timezone.

The trace records successful `find_notes` and `read_notes` calls and two current
passage sources from Cedar. The native assertion `Note answer must cite acquired
passages` fails on turn 4, before the fifth question can run. Retain this failure
even if a subsequent replay supplies citations.

Evidence: [trace](../referent-native-2.json), [log](../referent-native-2.log).
This is an inline-citation delivery failure, distinct from choosing the wrong
note. The retained final transcript does not establish whether the model omitted
a reference or the citation renderer removed an invalid reference. Do not infer
that moving history hints caused this isolated result.

## Acceptance ideas

- Reproduce the omission or capture the raw terminal model reference through a
  synthetic, bounded offline/native path before changing citation behavior.
- Preserve claim-level source validation and never append citations merely
  because an answer has read sources.
- Verify the actual delivered answer and citation navigation, including topic
  changes and repeated follow-ups. Keep failed attempts in the evaluation record.

## Comments

2026-10-10 — Found during the authorized conversational note-reference fix.


2026-10-10 — The unchanged third replay repeated an omission on its second turn
with correct fresh production facts. The renderer preserves invalid references
as unavailable markers rather than silently deleting them, but raw model text
was not captured in either failing attempt. From replay 4 onward the native
harness captures synthetic raw text deltas and retains citation failures while
finishing the five-turn sequence. Fresh reference-context guidance also reiterates
claim citations. Replays 4–8 all supplied valid inline citations (25 delivered
answers), with faithful raw-reference conversion. This mitigation and small sample
do not establish the precise original cause or general reliability; keep this
issue open. See [full retained evidence](../referent-validation.md).

2026-10-10 — A later [fixed-evidence runtime baseline](../../chat-reliability/citation-entailment/current-validation.md)
captures two raw answer citation failures: a trailing list citation with four
uncited preceding bullets, and literal 【Source】 on a partial-read claim. The
facts/uncertainty are correct. This synthesis harness supplies full synthetic
Markdown links instead of production [S#] references and does not run reference
conversion, so it does not establish the cause of the earlier native omissions.
Repeat the two cases with production reference preparation/rendering before a
prompt correction; preserve claim-level validation and avoid appending sources
based solely on their availability.

2026-10-10 — The [production-reference experiment](../../chat-reliability/citation-entailment/production-reference-validation.md)
retains raw and rendered output from 12 synthetic synthesis answers. Valid [S#]
references convert faithfully; raw missing references and final-bullet-only
scope recur. A short reminder did not improve reliably and was not promoted.
The synthesis harness omitted an existing read-tool reference instruction; a
limited calibration adds that sentence in the test preamble, still with a
per-bullet omission. These tests do not establish the cause of earlier native
omissions. Next: actual native read/tool context reproduction. Issue remains open.

2026-10-10 — The [native production-context reproduction](../../chat-reliability/citation-entailment/native-validation.md)
captures raw 【S2】 on a factually correct deadline answer, preserved as literal
text after rendering. Valid [S2] references in both retrospective answers map
faithfully to delivered body passages and resolve. Thus a malformed marker now
has native evidence; this still does not prove the cause of older uncaptured
omissions. One Flex failure was not retried. Production renderer/prompt unchanged;
consider narrow handling of exact issued reference variants under existing
delivery checks, without guessing sources or filling wholly missing citations.


## Rebuild disposition — 2026-10-16

Superseded as an executable old-runtime ticket by [the Pi rebuild](../../archive/pi-chat-rebuild-scope.md). Retain the original evidence without interpreting its runtime-specific next steps as current work. Current chat behavior and diagnostics are covered by rebuild tickets 02–08/10; intentionally dropped implicit context, exact Retry, formatter/projection or research requirements are not restored.
