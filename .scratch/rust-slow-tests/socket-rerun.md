# Sandbox-blocked test rerun

The serial profiling run failed only `agent_runtime::context_measurement::tests::capacity_probe_backs_off_unknown_but_refreshes_success_and_model_changes` at context_measurement.rs:456 because the sandbox denied its local socket bind (OS error 1, PermissionDenied).

Rerun with local socket access:

```
src-tauri/target/debug/deps/gneauxghts_lib-ded807626eccf288 --exact agent_runtime::context_measurement::tests::capacity_probe_backs_off_unknown_but_refreshes_success_and_model_changes
```

Observed tool output: 1 passed, 0 failed, 0 ignored, 740 filtered out, finished in 0.02s; exit 0. No source or environment workaround changes were needed.
