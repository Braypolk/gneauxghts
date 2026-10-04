# Investigate opaque ChromeDriver session creation failures

Status: needs-triage
Progress: Observed twice in a complete run; both affected files passed a targeted run unchanged. No application assertion failed in these two files.

In browser-awake.log, selection-menu and settings workers failed POST /session
at 2026-10-04T08:22:17Z and 08:22:20Z with WebDriverError [object Object], before
running test hooks/cases. Other workers before, between and afterward passed.
Versions: Chrome/driver154.0.8037.98, WDIO9.30.1, tauri-service1.3.0.
Command-scoped caffeinate assertions were active. This is distinct from the
previous run's evidenced host sleep and from the corrected Atlas pointer target.

The failed sessions left driver PIDs84718/84744 on ports54886/54926. They were
verified by exact executable/port and terminated after recording them. No normal
browser or active test driver was stopped. No harness setting was changed.

Both suites then ran headlessly with debug logging: nine cases passed. Preserve
browser-session-check.log as a successful admission trace and browser-awake.log
as the failed trace. A future reproduction should capture raw new-session response
and service driver spawn/teardown diagnostics rather than increasing retries or
changing application assertions. The original raw response is not available, so
no specific driver or resource-exhaustion cause is claimed.
