//! Device-local runtime installation. Only an explicit Settings setup action
//! downloads executable code; ordinary embedding requests never install it.
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

// Official release assets and their GitHub SHA-256 digests. Keep the version
// pinned: an upstream release must be verified before changing these values.
const VERSION: &str = "b11312";
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;

struct RuntimeArtifact {
    platform: &'static str,
    sha256: &'static str,
}

impl RuntimeArtifact {
    fn for_platform(os: &str, arch: &str) -> Result<Self, String> {
        let (platform, sha256) = match (os, arch) {
            ("macos", "aarch64") => (
                "macos-arm64",
                "3ceea603e48367ab694822f7304e6880817337f942f9672321411932c76c46f2",
            ),
            ("macos", "x86_64") => (
                "macos-x64",
                "c78ebb522375db1675d5df252b0a36dbec8822425852673a5f22c8c9eaa23b86",
            ),
            ("linux", "x86_64") => (
                "ubuntu-x64",
                "c250f4a85fb736b92ab369e531c2c769af4ad6180718c72ac0350e26678008de",
            ),
            ("linux", "aarch64") => (
                "ubuntu-arm64",
                "fb665e51a07d65156d0a4a327b318fe068184557c499772788049a6660106262",
            ),
            ("windows", "x86_64") => (
                "win-cpu-x64",
                "d2d966c23e4d097d70633f9d92e4931245b575be7a5409201d8f352493f0e702",
            ),
            ("windows", "aarch64") => (
                "win-cpu-arm64",
                "1822a499587503423f65cc9348253d6f883c799116becdb36baa3f9e14390c2d",
            ),
            _ => return Err(
                "Local search setup is unavailable on this device. Keyword search is available."
                    .to_string(),
            ),
        };
        Ok(Self { platform, sha256 })
    }

    fn is_zip(&self) -> bool {
        self.platform.starts_with("win-")
    }

    fn file_name(&self) -> String {
        let extension = if self.is_zip() { "zip" } else { "tar.gz" };
        format!("llama-{VERSION}-bin-{}.{extension}", self.platform)
    }

    fn directory(&self, root: &Path) -> PathBuf {
        root.join(format!("{VERSION}-{}", self.platform))
    }
}

pub(super) struct RuntimeInstaller {
    root: PathBuf,
}

impl RuntimeInstaller {
    pub(super) fn new(app_data: &Path) -> Self {
        Self {
            root: app_data.join("semantic").join("runtime"),
        }
    }

    pub(super) fn installed_binary(&self) -> Option<PathBuf> {
        let artifact =
            RuntimeArtifact::for_platform(std::env::consts::OS, std::env::consts::ARCH).ok()?;
        find_server(&artifact.directory(&self.root), 3)
    }

    pub(super) fn install(&self, client: &Client) -> Result<PathBuf, String> {
        let artifact = RuntimeArtifact::for_platform(std::env::consts::OS, std::env::consts::ARCH)?;
        if let Some(binary) = self.installed_binary() {
            return Ok(binary);
        }
        fs::create_dir_all(&self.root).map_err(|err| err.to_string())?;
        let mut nonce = [0; 8];
        getrandom::fill(&mut nonce).map_err(|err| err.to_string())?;
        let staging = Staging(
            self.root
                .join(format!(".setup-{:016x}", u64::from_le_bytes(nonce))),
        );
        fs::create_dir(&staging.0).map_err(|err| err.to_string())?;
        let url = format!(
            "https://github.com/ggml-org/llama.cpp/releases/download/{VERSION}/{}",
            artifact.file_name()
        );
        let response = client.get(url).send()
            .and_then(|response| response.error_for_status())
            .map_err(|err| format!("Could not download local search files. Check your connection and try Set up local search again. {err}"))?;
        let archive = staging.0.join(artifact.file_name());
        save_verified_archive(response, &archive, artifact.sha256)?;
        self.publish_archive(&artifact, &archive, &staging.0)
    }

    fn publish_archive(
        &self,
        artifact: &RuntimeArtifact,
        archive: &Path,
        staging: &Path,
    ) -> Result<PathBuf, String> {
        let extracted = staging.join("extracted");
        fs::create_dir(&extracted).map_err(|err| err.to_string())?;
        if artifact.is_zip() {
            let file = fs::File::open(archive).map_err(|err| err.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|err| err.to_string())?;
            zip.extract(&extracted)
                .map_err(|err| format!("Could not unpack local search files: {err}"))?;
        } else {
            let file = fs::File::open(archive).map_err(|err| err.to_string())?;
            let gzip = flate2::read::GzDecoder::new(file);
            tar::Archive::new(gzip)
                .unpack(&extracted)
                .map_err(|err| format!("Could not unpack local search files: {err}"))?;
        }
        let binary = find_server(&extracted, 3).ok_or_else(|| {
            "Local search download is incomplete. Try Set up local search again.".to_string()
        })?;
        // Check the executable AND its shipped shared libraries before publishing
        // the directory. Missing dependencies cannot leave an installed marker.
        verify_binary(&binary)?;
        let relative = binary
            .strip_prefix(&extracted)
            .map_err(|err| err.to_string())?
            .to_path_buf();
        let destination = artifact.directory(&self.root);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|err| err.to_string())?;
        }
        fs::rename(&extracted, &destination)
            .map_err(|err| format!("Could not install local search files: {err}"))?;
        Ok(destination.join(relative))
    }
}

struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn save_verified_archive(input: impl Read, path: &Path, expected: &str) -> Result<(), String> {
    save_verified_archive_with_limit(input, path, expected, MAX_ARCHIVE_BYTES)
}

fn save_verified_archive_with_limit(
    mut input: impl Read,
    path: &Path,
    expected: &str,
    limit: u64,
) -> Result<(), String> {
    let mut file = fs::File::create(path).map_err(|err| err.to_string())?;
    let mut hash = Sha256::new();
    let mut bytes = 0u64;
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|err| {
            format!("Local search download was interrupted. Try setup again. {err}")
        })?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > limit {
            return Err("Local search download exceeded its size limit.".to_string());
        }
        hash.update(&buffer[..count]);
        file.write_all(&buffer[..count])
            .map_err(|err| err.to_string())?;
    }
    file.sync_all().map_err(|err| err.to_string())?;
    let actual = hex::encode(hash.finalize());
    if actual != expected {
        return Err(
            "Local search download could not be verified. Try Set up local search again."
                .to_string(),
        );
    }
    Ok(())
}

fn find_server(directory: &Path, depth: usize) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let candidate = directory.join(name);
    if candidate.is_file() {
        return Some(candidate);
    }
    if depth == 0 {
        return None;
    }
    for entry in fs::read_dir(directory).ok()?.flatten() {
        if entry.file_type().ok()?.is_dir() {
            if let Some(found) = find_server(&entry.path(), depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

fn verify_binary(binary: &Path) -> Result<(), String> {
    verify_binary_with_timeout(binary, Duration::from_secs(10))
}

fn verify_binary_with_timeout(binary: &Path, timeout: Duration) -> Result<(), String> {
    let mut command = Command::new(binary);
    // Version output is irrelevant to installation admission. Null streams
    // prevent a malformed runtime from filling a pipe while we await its exit.
    command
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command
        .spawn()
        .map_err(|err| format!("Local search could not start on this device: {err}"))?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!(
                        "Local search could not start on this device. Try setup again. {status}"
                    ))
                }
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(error) => format!("Local search could not start on this device: {error}"),
                    _ => "Local search verification timed out. Try setup again.".to_string(),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    fn temp_root() -> Staging {
        let mut nonce = [0; 8];
        getrandom::fill(&mut nonce).unwrap();
        let dir = std::env::temp_dir().join(format!(
            "gneauxghts-runtime-test-{:016x}",
            u64::from_le_bytes(nonce)
        ));
        fs::create_dir(&dir).unwrap();
        Staging(dir)
    }

    #[test]
    fn corrupted_download_never_becomes_an_installed_runtime() {
        let root = temp_root();
        let installer = RuntimeInstaller::new(&root.0);
        let archive = root.0.join("download.tar.gz");
        assert!(save_verified_archive(
            io::Cursor::new(b"interrupted download"),
            &archive,
            &"0".repeat(64)
        )
        .is_err());
        assert!(installer.installed_binary().is_none());
    }

    #[test]
    fn incomplete_archive_never_becomes_discoverable() {
        let root = temp_root();
        let installer = RuntimeInstaller::new(&root.0);
        let artifact = RuntimeArtifact::for_platform("macos", "aarch64").unwrap();
        let archive = root.0.join("incomplete.tar.gz");
        let gzip = flate2::write::GzEncoder::new(
            fs::File::create(&archive).unwrap(),
            flate2::Compression::default(),
        );
        let mut tar = tar::Builder::new(gzip);
        let mut header = tar::Header::new_gnu();
        header.set_size(4);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, "runtime/LICENSE", &b"test"[..])
            .unwrap();
        tar.into_inner().unwrap().finish().unwrap();
        assert!(installer
            .publish_archive(&artifact, &archive, &root.0)
            .is_err());
        assert!(!artifact.directory(&installer.root).exists());
        assert!(installer.installed_binary().is_none());
    }

    #[test]
    fn pinned_artifacts_cover_desktop_architectures() {
        for os in ["macos", "linux", "windows"] {
            for arch in ["aarch64", "x86_64"] {
                let artifact = RuntimeArtifact::for_platform(os, arch).unwrap();
                assert_eq!(artifact.sha256.len(), 64);
            }
        }
        assert!(RuntimeArtifact::for_platform("ios", "aarch64").is_err());
    }

    #[test]
    fn bounded_archive_reads_and_interruption_leave_only_disposable_staging() {
        struct Interrupted;
        impl Read for Interrupted {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::new(
                    io::ErrorKind::ConnectionReset,
                    "fixture interruption",
                ))
            }
        }
        let root = temp_root();
        let path = root.0.join("download");
        let digest = hex::encode(Sha256::digest(b"1234"));
        save_verified_archive_with_limit(io::Cursor::new(b"1234"), &path, &digest, 4).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"1234");
        assert!(
            save_verified_archive_with_limit(io::Cursor::new(b"12345"), &path, &digest, 4)
                .unwrap_err()
                .contains("size limit")
        );
        assert!(save_verified_archive(Interrupted, &path, &digest)
            .unwrap_err()
            .contains("interrupted"));
        let staging_path = root.0.clone();
        drop(root);
        assert!(!staging_path.exists());
    }

    #[cfg(unix)]
    fn script_archive(path: &Path, body: &str) {
        let gzip = flate2::write::GzEncoder::new(
            fs::File::create(path).unwrap(),
            flate2::Compression::default(),
        );
        let mut tar = tar::Builder::new(gzip);
        let mut header = tar::Header::new_gnu();
        header.set_size(body.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        tar.append_data(&mut header, "runtime/llama-server", body.as_bytes())
            .unwrap();
        tar.into_inner().unwrap().finish().unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn local_archive_is_verified_before_publication_and_discovery() {
        for succeeds in [false, true] {
            let root = temp_root();
            let installer = RuntimeInstaller::new(&root.0);
            fs::create_dir_all(&installer.root).unwrap();
            let artifact =
                RuntimeArtifact::for_platform(std::env::consts::OS, std::env::consts::ARCH)
                    .unwrap();
            let archive = root.0.join("local.tar.gz");
            script_archive(
                &archive,
                if succeeds {
                    "#!/bin/sh\nexit 0\n"
                } else {
                    "#!/bin/sh\nexit 1\n"
                },
            );
            let installed = installer.publish_archive(&artifact, &archive, &root.0);
            if succeeds {
                assert_eq!(installer.installed_binary(), Some(installed.unwrap()));
            } else {
                assert!(installed.is_err());
                assert!(installer.installed_binary().is_none());
            }
        }
    }

    #[test]
    #[cfg(unix)]
    fn verification_times_out_and_reaps_the_child() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root();
        let binary = root.0.join("busy-server");
        fs::write(&binary, "#!/bin/sh\nwhile :; do :; done\n").unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            verify_binary_with_timeout(&binary, Duration::from_millis(20))
                .unwrap_err()
                .contains("timed out")
        );
        // The bounded verifier returned only after kill+wait; removal does not
        // leave an owned Child handle or an unreaped verifier process.
    }

    // Opt-in live fixture: exercise checksum, extraction, dylib resolution,
    // executable launch, publication and discovery using the official archive.
    #[test]
    #[ignore = "requires GNEAUXGHTS_RUNTIME_TEST_ARCHIVE pointing to the pinned official archive"]
    fn official_archive_installs_and_starts_without_system_runtime() {
        let archive = PathBuf::from(
            std::env::var_os("GNEAUXGHTS_RUNTIME_TEST_ARCHIVE").expect("archive path"),
        );
        let root = temp_root();
        let installer = RuntimeInstaller::new(&root.0);
        let artifact =
            RuntimeArtifact::for_platform(std::env::consts::OS, std::env::consts::ARCH).unwrap();
        let verified = root.0.join(artifact.file_name());
        save_verified_archive(fs::File::open(archive).unwrap(), &verified, artifact.sha256)
            .unwrap();
        fs::create_dir_all(&installer.root).unwrap();
        let binary = installer
            .publish_archive(&artifact, &verified, &root.0)
            .unwrap();
        assert_eq!(installer.installed_binary(), Some(binary.clone()));
        verify_binary(&binary).unwrap();

        use crate::semantic::embed::{
            EmbeddingInputKind, EmbeddingProvider, JinaLlamaEmbeddingProvider,
        };
        let provider = JinaLlamaEmbeddingProvider::new(
            root.0.clone(),
            None,
            std::sync::Arc::new(crate::semantic::debug::SemanticDebugState::new()),
        )
        .unwrap();
        assert_eq!(
            provider.model_info().runtime_binary_path,
            Some(binary.to_string_lossy().into_owned())
        );
        // Optionally exercise real model loading and embedding, through the
        // production provider, without touching the existing app's cache.
        if let Some(model) = std::env::var_os("GNEAUXGHTS_RUNTIME_TEST_MODEL") {
            let models = root.0.join("semantic/models");
            fs::create_dir_all(&models).unwrap();
            let destination = models.join("jina-embeddings-v5-text-nano-retrieval-Q6_K.gguf");
            fs::copy(PathBuf::from(model), destination).unwrap();
            provider.prepare().unwrap();
            let embeddings = provider
                .embed_texts(
                    &["Local search setup verification".to_string()],
                    EmbeddingInputKind::Query,
                )
                .unwrap();
            assert_eq!(embeddings.len(), 1);
            assert_eq!(embeddings[0].len(), 768);
            assert!(embeddings[0].iter().all(|value| value.is_finite()));
        }
    }
}
