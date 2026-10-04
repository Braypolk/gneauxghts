# Pre-merge integration validation

Progress: Complete. See results.md for final passing local gates, corrected findings, merge handoff, and the unresolved intermittent browser caveat.

The user approved the proposed final merge-diff review, ordinary frontend/Rust/Python/production gates, browser/native smoke plus actual restart, and verification from a clean checkout. Do not merge, commit, push or overwrite the user's original checkout. Temporary local commits in a disposable validation repository may identify and test the proposed contents.

Baseline: current detached HEAD cb4d4c02f0e2c1220d37b281ee300eff1aabf20b plus all accumulated tracked and intentional untracked changes. Local main is 04f13b35a253974c01070a7502c940e20332b165, one new commit adding Open File Location; origin/main is older. Validate integration with local main and record both references. Do not fetch or claim current remote CI status.

Audit inclusion of new source, configuration, fixture archives and Markdown reports. Exclude generated untracked Python caches and local diagnostic logs/raw snapshots from proposed merge contents; record exclusions without deleting originals. New fixture archives and their generator are required inputs.

Use independent reviews of backend, frontend, and test/harness contracts against the entire baseline diff, not just the final three tests. Existing phase reports are evidence and navigation, not substitutes for inspecting current integrated call paths. Record concrete findings before corrections. Root owns all test/build execution; source freeze during browser/native runs. Tests use only disposable vaults and owned servers/processes.

Clean validation checkout must have independent dependency installation and no copied application/build/test caches. Package-manager download caches are acceptable and must be disclosed. Run default-concurrency Rust tests, production checks/build, typechecking, frontend/support/Python tests, browser tests, freshly built native smoke and actual process restart. Preserve failures, diagnose rather than weaken checks, and rerun affected gates after fixes. Finish with a precise readiness assessment and limitations.
