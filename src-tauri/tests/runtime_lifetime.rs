//! Exercise the shipped executable's headless supervisor entrypoint, before
//! Tauri setup, against a real process (no model download or desktop needed).
#![cfg(unix)]

use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[test]
fn executable_supervisor_releases_the_runtime_when_its_owner_pipe_closes() {
    let mut supervisor = Command::new(env!("CARGO_BIN_EXE_gneauxghts"))
        .args([
            "--gneauxghts-runtime-supervisor",
            "/bin/sh",
            "-c",
            "printf 'runtime-pid=%s\\n' $$; printf '%s\\n' \"$RUNTIME_LIFETIME_TEST\"; exec sleep 60",
        ])
        .env("RUNTIME_LIFETIME_TEST", "spaces and 'quotes' preserved")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let output = supervisor.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut output = BufReader::new(output).lines();
        let pid = output.next().unwrap().unwrap();
        let value = output.next().unwrap().unwrap();
        tx.send((pid, value)).unwrap();
    });
    let startup = rx.recv_timeout(Duration::from_secs(5));
    // Always request cleanup, including when the startup assertion fails.
    drop(supervisor.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = supervisor.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= deadline {
            supervisor.kill().unwrap();
            supervisor.wait().unwrap();
            panic!("supervisor did not finish after its owner pipe closed");
        }
        thread::sleep(Duration::from_millis(10));
    };
    let (pid, value) = startup.expect("runtime startup through production executable");
    let pid: u32 = pid.strip_prefix("runtime-pid=").unwrap().parse().unwrap();
    assert!(status.success(), "{status}");
    assert_eq!(value, "spaces and 'quotes' preserved");
    assert!(
        !Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success(),
        "runtime {pid} survived shutdown"
    );
}
