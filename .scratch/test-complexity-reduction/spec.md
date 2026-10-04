# Reduce test and supporting-code complexity

The user rejected the previous remediation's growth and explicitly asks to address complexity. Preserve useful bug fixes; simplify the CURRENT working tree rather than revert it wholesale. Baseline is the saved current-source snapshot in baseline.json, not HEAD. Prior audit records remain historical.

Success requires a demonstrated reduction in maintained test/setup/mocking machinery, redundant coverage and unnecessary production interfaces. Fewer reported tests alone is not success: do not hide cases inside loops, remove discovered-bug protection, move code into helpers without reducing caller burden, or weaken assertions to obtain green runs. Parameterization is useful only when it removes repeated setup and retains clear failure diagnostics. Preserve distinct real persistence/transaction/rollback, permission, concurrency and browser/native geometry boundaries.

Each area first records a behavior-ownership/deletion proposal with exact files, retained owner for removed protection, setup/interface burden removed and risk. Root reviews before implementation. Prefer removing superseded shallow/module tests where real composition now covers the same behavior. New tests require an identified uncovered contract and should replace overlap where possible. No speculative new abstractions, giant opaque scenario tests or arbitrary numerical quota.

Measure before/after against the saved snapshot: test-bearing files and LOC (including helpers), executed case counts and controlled same-command timing where informative. Report production simplification separately. Required local checks and independent review must pass. No commits/push/deploy requested.
