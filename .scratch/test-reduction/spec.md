# Test reduction

Audit and reduce genuinely overlapping, duplicate or low-value tests across frontend, Rust, browser/native and support suites. Preserve distinct behavioral, platform, corruption and race contracts. Test-count reduction must represent deleted redundant scenarios, not renamed/combined cases or moved assertions. Do not rewrite production to satisfy a deletion quota.

Persist all module audits before source edits. Each deletion names surviving coverage or explicitly justifies the assertion as implementation trivia. Independent review checks coverage preservation and maintenance reduction. Baseline is the saved current working tree, not HEAD; earlier uncommitted rewrites remain untouched.

Baseline validated in prior phase: frontend1137; Rust library746 (15 ignored separately), architecture23; support32; Python8; browser26 files; native smoke13 cases. Recount final executable tests and report physical test-code savings separately.
