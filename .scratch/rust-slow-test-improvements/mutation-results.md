# Mutation sensitivity

Both corrected tests detect the relevant regression, with exact source restored after each experiment.

- Payload cancellation: removing only the replay-loop checkpoint changes the outcome to corruption and fails the test's Unavailable assertion. Test completed with expected failure in 0.12s; compilation excluded. See mutation-cancellation.log/json.
- Recovery ownership: retaining the observer/probes but dropping the real shared guard before the gated recovery operation prevents the competing callers from reporting WouldBlock. The test fails at its contention receive (tests.rs:534) in 5.08s, and scoped workers terminate without hanging. See mutation-recovery.log/json. The mutation is enabled only once the test observer is installed; fixture setup remains normal.
- An earlier overbroad recovery mutation also changed initial fixture setup and stalled. Because it affected operations outside the scheduled scenario, the stall is not evidence for the intended lock-lifetime assertion. That process was stopped after approximately 59s including compilation; the script restored the source. It provides no sensitivity result. Its log is retained as mutation-recovery-setup-aborted.log/json. The narrowed experiment above replaced it.

All four retained source hashes match independent review, and history_store.rs is byte-identical to the phase baseline. No temporary mutation remains. Final normal compilation, repeated tests and whole-suite acceptance follow restoration.
