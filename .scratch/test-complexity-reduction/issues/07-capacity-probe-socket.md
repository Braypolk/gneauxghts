# 07 — Bound the capacity-probe HTTP fixture's accepted socket mode

Status: ready-for-agent
Progress: Complete; implemented, reviewed, and accepted after combined validation. See ../validation.md.
Owner: audit_agent

## Evidence and hypothesis

`../final-rust.log` reports742 passed,1 failed,15 ignored. The failure begins in the fixture worker at `agent_runtime/context_measurement.rs:513`: `read_exact` returns macOS errno35 WouldBlock before the request count increments. The subsequent expected1/actual0 probe-count assertion is a consequence, not a production capacity-cache defect. The listener is explicitly nonblocking to allow bounded accept/stop polling. Its accepted stream only gets a read timeout, never an explicit blocking mode. On systems where accepted sockets inherit nonblocking mode, read timeout does not make an immediate empty-buffer read wait.

The existing focused test passed when bytes happened to arrive before read; combined load exposes that scheduler-dependent fixture assumption. Verify inherited descriptor flags with a small local native-accept probe, then explicitly set accepted stream blocking before its existing5-second read timeout. Keep nonblocking listener/stop guard, request/header bounds, five scripted responses, injected observation times, backoff/model-change assertions unchanged. No new test, mock framework, retry loop or relaxed assertion.

## Verification plan

Root has browser tests running; no Cargo compilation until root releases that slot. After source fix, root can include it in final compilation and run this exact capacity-probe test once with local socket permission. Persist result and distinguish fixture correction from application behavior changes.

## Confirmed diagnosis and correction

`../07-socket-flags.json` records a native `accept()` call on this Darwin host: accepted descriptor O_NONBLOCK=true; explicitly switching blocking mode changes it to false. The diagnostic bypassed Python socket accept normalization by calling native accept through ctypes, so it observed the OS behavior directly. This confirms nonblocking inheritance rather than a5-second request-read timeout. The existing code fails immediately when the accepted connection has not yet supplied header bytes.

Added `stream.set_nonblocking(false).unwrap()` before the unchanged read timeout, with a two-line explanatory comment. **Delta:+3 test-support lines, zero production lines, zero cases.** Root's preceding reduction totals of2265/2172/93 therefore become **2262 total lines removed:2169 test/support and93 production**, assuming no other changes. No listener polling, response, cache assertion or production behavior altered.

## Verification result

`cargo test --manifest-path src-tauri/Cargo.toml --lib agent_runtime::context_measurement::tests::capacity_probe_backs_off_unknown_but_refreshes_success_and_model_changes -- --exact --test-threads=1` compiled warning-free in14.73seconds and passed1/1 in0.03seconds with approved local socket access. Log:`../07-capacity-probe.log`. No extra test or repeated stress campaign added. Source stable; root will rerun combined Rust validation.
