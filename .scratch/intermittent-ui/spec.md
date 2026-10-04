# Investigate intermittent search and cursor failures

Progress: Complete. See results.md for the confirmed search correction, bounded cursor investigation, and final verification.

Use existing pre-merge issues 04 and 05 as evidence. Browser tests run headless;
no native or visible browser launches. Root owns test execution; cursor reviewer
is read-only. Preserve failing evidence and bound exploratory runs.

First pause a real note-open request, interact with search again, then complete
navigation. Record focus event order and search visibility. A controlled witness
can establish a real stale-focus defect without claiming it proves the exact
cause of a previous uninstrumented failure. Inspect cursor fixture/DOM/native/
CodeMirror admission separately. Record findings before production fixes. Do not
increase timeouts, repeat until green, or remove assertions to hide failures.
