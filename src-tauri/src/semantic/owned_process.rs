//! Keep the local runtime tied to its app even when native quit or a dev runner
//! terminates the app without running Rust destructors.
use std::{
    env,
    io::{self, Read},
    process::{Child, Command, ExitStatus, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

const SUPERVISOR_ARGUMENT: &str = "--gneauxghts-runtime-supervisor";

pub(super) struct OwnedProcess {
    child: Child,
}

impl OwnedProcess {
    pub(super) fn spawn(command: &Command) -> io::Result<Self> {
        let mut supervisor = Command::new(env::current_exe()?);
        supervisor
            .arg(SUPERVISOR_ARGUMENT)
            .arg(command.get_program());
        supervisor.args(command.get_args());
        Self::spawn_with_supervisor(command, supervisor)
    }

    fn spawn_with_supervisor(command: &Command, mut supervisor: Command) -> io::Result<Self> {
        for (name, value) in command.get_envs() {
            if let Some(value) = value {
                supervisor.env(name, value);
            } else {
                supervisor.env_remove(name);
            }
        }
        if let Some(directory) = command.get_current_dir() {
            supervisor.current_dir(directory);
        }
        // Terminal Ctrl-C must terminate the app, then close its ownership pipe.
        // Keep the supervisor alive long enough to kill and reap the runtime.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            supervisor.process_group(0);
        }
        let child = supervisor
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        Ok(Self { child })
    }

    pub(super) fn take_stdout(&mut self) -> Option<std::process::ChildStdout> {
        self.child.stdout.take()
    }

    pub(super) fn take_stderr(&mut self) -> Option<std::process::ChildStderr> {
        self.child.stderr.take()
    }

    pub(super) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }
}

impl Drop for OwnedProcess {
    fn drop(&mut self) {
        // Closing the pipe is the shutdown request. Killing the supervisor
        // itself would bypass its child cleanup and recreate the orphan bug.
        drop(self.child.stdin.take());
        let _ = self.child.wait();
    }
}

/// Runs before any Tauri initialization: this process must never create a
/// window, open the vault, or start another semantic worker.
pub(crate) fn run_if_requested() -> Option<i32> {
    let mut args = env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(SUPERVISOR_ARGUMENT)) {
        return None;
    }
    let Some(program) = args.next() else {
        eprintln!("Runtime supervisor requires an executable");
        return Some(1);
    };
    let mut command = Command::new(program);
    command.args(args);
    Some(match supervise(command) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("Runtime supervisor failed: {error}");
            1
        }
    })
}

fn supervise(mut command: Command) -> io::Result<i32> {
    let (closed_tx, closed_rx) = mpsc::channel();
    thread::Builder::new()
        .name("runtime-owner-pipe".into())
        .spawn(move || {
            let mut buffer = [0; 64];
            let mut input = io::stdin().lock();
            loop {
                match input.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(_) => continue,
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            let _ = closed_tx.send(());
        })?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.code().unwrap_or(1)),
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
        match closed_rx.recv_timeout(Duration::from_millis(20)) {
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                // This is the same terminal kill used by the provider today;
                // waiting also prevents a zombie runtime after owner death.
                let _ = child.kill();
                child.wait()?;
                return Ok(0);
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::time::Instant;

    // Re-enter the test executable in a headless subprocess. The real pipe,
    // supervisor loop, child process, and OS parent death stay under test.
    fn subprocess(role: &str) -> Command {
        let mut command = Command::new(env::current_exe().unwrap());
        let test_name = format!(
            "{}::subprocess_entrypoint",
            module_path!().split_once("::").unwrap().1
        );
        command
            .args(["--exact", &test_name, "--nocapture"])
            .env("GNEAUXGHTS_PROCESS_TEST_ROLE", role);
        command
    }

    fn runtime_command() -> Command {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "echo runtime-pid=$$; exec sleep 60"]);
        command
    }

    fn runtime_pid(stdout: impl Read + Send + 'static) -> u32 {
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let line = line.unwrap();
                if let Some(pid) = line.strip_prefix("runtime-pid=") {
                    tx.send(pid.parse::<u32>().unwrap()).unwrap();
                    return;
                }
            }
        });
        rx.recv_timeout(Duration::from_secs(5))
            .expect("runtime announced its PID")
    }

    fn is_running(pid: u32) -> bool {
        Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    }

    fn assert_stopped(pid: u32) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while is_running(pid) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(!is_running(pid), "runtime {pid} survived its owner");
    }

    #[test]
    fn subprocess_entrypoint() {
        match env::var("GNEAUXGHTS_PROCESS_TEST_ROLE").as_deref() {
            Ok("supervisor") => {
                let mut command = runtime_command();
                if let Ok(code) = env::var("GNEAUXGHTS_PROCESS_TEST_EXIT_CODE") {
                    command = Command::new("/bin/sh");
                    command.args(["-c", &format!("exit {code}")]);
                }
                std::process::exit(supervise(command).unwrap());
            }
            Ok("owner") => {
                let mut runtime = OwnedProcess::spawn_with_supervisor(
                    &runtime_command(),
                    subprocess("supervisor"),
                )
                .unwrap();
                let pid = runtime_pid(runtime.take_stdout().unwrap());
                println!("runtime-pid={pid}");
                // The controller kills this owner process. Destructors cannot
                // assist the supervisor in this case.
                loop {
                    thread::park();
                }
            }
            _ => {}
        }
    }

    #[test]
    fn dropping_runtime_stops_and_reaps_the_child() {
        let mut runtime =
            OwnedProcess::spawn_with_supervisor(&runtime_command(), subprocess("supervisor"))
                .unwrap();
        let pid = runtime_pid(runtime.take_stdout().unwrap());
        assert!(is_running(pid));
        drop(runtime);
        assert_stopped(pid);
    }

    #[test]
    fn runtime_does_not_survive_abrupt_app_death() {
        use std::os::unix::process::CommandExt;
        for signal in ["-KILL", "-TERM", "-INT"] {
            let mut owner = subprocess("owner")
                .process_group(0)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap();
            let pid = runtime_pid(owner.stdout.take().unwrap());
            assert!(is_running(pid));
            // Signal the owner's whole terminal group, as Ctrl-C does. The
            // supervisor must survive this signal to clean up its own child.
            let signal_result = Command::new("/bin/kill")
                .args([signal, "--", &format!("-{}", owner.id())])
                .status()
                .unwrap();
            if !signal_result.success() {
                let _ = owner.kill();
            }
            owner.wait().unwrap();
            assert!(signal_result.success());
            assert_stopped(pid);
        }
    }

    #[test]
    fn runtime_exit_is_reported_without_waiting_for_app_death() {
        let mut supervisor = subprocess("supervisor");
        supervisor.env("GNEAUXGHTS_PROCESS_TEST_EXIT_CODE", "7");
        let mut runtime =
            OwnedProcess::spawn_with_supervisor(&runtime_command(), supervisor).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let status = loop {
            if let Some(status) = runtime.try_wait().unwrap() {
                break status;
            }
            assert!(Instant::now() < deadline, "runtime exit was not reported");
            thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(status.code(), Some(7));
    }
}
