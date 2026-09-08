//! Native process interruption hooks. This module is absent from ordinary builds.
//! The harness owns the child and SIGKILL; a hook only acknowledges and parks.
use std::{fs, io::Write, path::PathBuf, sync::OnceLock, thread, time::Duration};

fn fixture() -> Option<&'static PathBuf> {
    static FIXTURE: OnceLock<Option<PathBuf>> = OnceLock::new();
    FIXTURE
        .get_or_init(|| {
            let root = PathBuf::from(std::env::var_os("GNEAUXGHTS_PROCESS_FAULT_ROOT")?);
            let root = root.canonicalize().ok()?;
            let temporary = std::env::temp_dir().canonicalize().ok()?;
            if root.parent() != Some(temporary.as_path())
                || !root
                    .file_name()?
                    .to_str()?
                    .starts_with("gneauxghts-process-relaunch-")
                || fs::read_to_string(root.join("owner.txt")).ok()?.trim() != "issue48-disposable"
            {
                return None;
            }
            // Fault injection is impossible unless every native startup path is
            // explicitly bound to this purpose-created disposable directory.
            let args = std::env::args_os().collect::<Vec<_>>();
            for (flag, suffix) in [
                ("--e2e-app-data-root", "app-data"),
                ("--e2e-documents-root", "documents"),
                ("--e2e-vault-root", "vault"),
            ] {
                let index = args.iter().position(|arg| arg == flag)?;
                if PathBuf::from(args.get(index + 1)?).canonicalize().ok()? != root.join(suffix) {
                    return None;
                }
            }
            Some(root)
        })
        .as_ref()
}

pub(crate) fn hit(point: &str) {
    let Some(root) = fixture() else { return };
    let Ok(control) = fs::read(root.join("fault.json")) else {
        return;
    };
    let Ok(control) = serde_json::from_slice::<serde_json::Value>(&control) else {
        return;
    };
    if control["point"].as_str() != Some(point) {
        return;
    }
    let Some(token) = control["token"].as_str() else {
        return;
    };
    let acknowledgement = serde_json::json!({
        "point": point, "token": token, "pid": std::process::id(),
        "fixture": root, "acknowledgedAtMillis": crate::time::current_time_millis().ok()
    });
    // create_new makes the first matching boundary the only acknowledgement.
    let Ok(mut marker) = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join("ack.json"))
    else {
        return;
    };
    marker
        .write_all(acknowledgement.to_string().as_bytes())
        .expect("write process fault acknowledgement");
    marker
        .sync_all()
        .expect("sync process fault acknowledgement");
    eprintln!("E2E_PROCESS_FAULT {acknowledgement}");
    loop {
        thread::park_timeout(Duration::from_secs(60));
    }
}
