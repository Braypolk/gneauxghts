# Historical experiments

`history_index_baseline.py` is the preserved schema-13 allocation and owned-copy
DROP/VACUUM experiment. It accepts sealed old-format current-scale fixtures only;
it is not a current schema regression test and is excluded from ordinary gates.
It previously lived at `scripts/history_index_baseline.py`; original audit and
measurement records retain that historical path. Its fixture seals, symlink
checks, immutable reads and owned-copy mutation rules are unchanged.

Current fixture creation/admission lives in `scripts/timeline_fixture.py` and
`e2e/support/currentScaleFixture.mjs`; current native evidence is documented in
`e2e/README.md`. No historical evidence or result artifacts were removed.
