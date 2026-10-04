# Validation

1. Compile test binary separately; do not include compile time in execution comparisons.
2. Run explicit ignored generator once. Record generation time and archive sizes; production writer recipes and public clean close must succeed.
3. Hash immutable masters, then run exactly the three original reader test names in a fresh process. Include archive decoding, copying, path relocation, normal catalog initialization and query execution in timing. Compare with21.52s original.
4. Re-run the three readers to exercise independent private copies after the original tests clear history. Require unchanged master hashes.
5. Run full library suite at default concurrency against117.63s original saved-binary baseline; no simultaneous tests/builds/typechecks. All725 existing regular tests must pass. One extra ignored maintenance generator is expected; existing15 ignored remain.
6. Run21 architecture cases. Confirm no non-test production behavior changed, all original read assertion tails preserved, and long-chain checkpoint writer test remains live.
7. Review helper/fixture scope independently and retain source diff relative to this phase's saved working-tree snapshot. Final report distinguishes query-fixture savings from full-suite/compile costs, and documents regeneration.
