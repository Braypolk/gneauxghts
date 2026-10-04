# Profiling experiments

Before source edits: current tree saved in baseline.json. Node v24.2.0, Vitest 3.2.6, macOS, 12 available CPUs. Root runs measurements serially; investigators perform only reads.

Frontend baseline full run: 143 files / 1,065 passes; 19.33s wall, 10.03s aggregate transform, 181.62s aggregate collect, 4.19s aggregate tests. Parallel categories are not additive. Config uses default fork pool and worker count; isolation retained.

Hypotheses: excessive concurrent independent transforms/worker startup versus inherently expensive import graph. Probe four workers in the same fork pool, then four isolated threads; no production/source change required. Keep a repeat baseline to detect warmup/order noise. Lower count is not a goal.

Rust hypothesis (not yet established): global fixture lock can inflate individual parallel durations; serial test timings will distinguish intrinsic fixture expense from lock wait. Inspect worker teardown before changing production behavior.

Discard first forks4/threads4 timing: threads4 was accidentally started before forks4 finished; threads4 was interrupted and forks4 completed. Neither run is used for performance comparisons. Repeat serially and wait for confirmed completion.

Clean frontend probes (all 143 files / 1,065 passes): forks4 21.89s; threads4 15.42s; threads default worker count 11.69s. No competing test/build/check workloads. Default isolated threads is the leading configuration; do not hard-code this machine's worker count. Repeat control/candidate before accepting.

Rust serial same compiled binary: 725 passes / 15 ignored, 112.61s (no compilation). Per-test approximate elapsed spans from serial pretty stdout, recorded in rust-serial-baseline.json. Top four: query inventory pagination14.70s, adaptive checkpoints11.03s, dense notes7.20s, revision context paging6.86s =39.79s. Minimal foreground guard fixture3.7ms; three-save/window example320.5ms; task commit167.3ms. This argues against generic fixture startup/teardown as the largest cost. Inspect dense setup before changing persistence or dropping guards. Full default parallel suite in prior phase114.53s is contextual, not a controlled concurrent comparison.

Frontend repeat baseline17.90s confirms modest run-to-run variation; first baseline19.33s. Candidate thread repeat running before edits.

Thread repeat11.75s (first11.69s), compared with fork baselines19.33/17.90s: supported configuration improvement, no worker-count override needed. All four full runs preserve143files/1,065passes. Adopt isolated threads in config; default isolation remains true. Root-only import plan persisted separately before the three-file edit, with focused baseline under threads to separate import savings from pool savings.

Root import correction measured with isolated threads: same4files/26cases4.91s before vs0.420s after. Full frontend candidate8.95s, all143files/1,065passes. Exact full case-name inventory matches original JSON. Svelte+E2E TypeScript check passes. Independent frontend review found no blocker; removed its unused-import nit.

Rust two-fixture experiment adds only real foreground admission around canonical seed loops and drains existing background queue before assertions/restart. Fresh-process original7.37/8.60s vs candidate7.45/6.15s. Long-chain case2.46/2.86 vs1.92/2.07s; dense case4.91/5.74 vs5.52/4.08s. Mixed/noisy results: do not present these as a stable whole-suite gain. Run full serial candidate against112.61s baseline and review semantics before retention decision.


Rust decision: full serial candidate111.56s versus112.61s original (about1%, within observed variation). All725pass/15ignored, correctness review passed, but no convincing overall performance benefit. Reverted both fixture edits exactly to saved baseline bytes; preserved rejected-rust-fixture-experiment.patch. No Rust optimization retained and no Rust speedup claimed. Avoid extra test scheduling complexity for an uncertain benefit.


Final normal pnpm test command passed32support +1,065frontend/143files; frontend9.03s. First sandbox attempt could not bind localhost (EPERM); authorized socket-access rerun passed. Final frontend repeats8.95/9.03s vs original19.33/17.90s. Retained4files, net7lines removed, no tests changed. Rust files restored exactly and binary rebuilt after touching restored file timestamps so Cargo cannot mistake the rejected candidate for current source.
