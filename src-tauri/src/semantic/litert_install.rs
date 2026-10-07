//! Explicit Settings setup installs the pinned native library, not Python.
use reqwest::blocking::Client;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(super) const MODEL_FILE: &str = "embeddinggemma-2-text-vision-440m.litertlm";
pub(super) const MODEL_REPO: &str = "litert-community/embeddinggemma-2-text-vision-440m-litert-lm";
pub(super) const MODEL_REV: &str = "e301f74d5551b0c2641bd5cb4652a76239d5c5f8";
pub(super) const MODEL_SHA: &str =
    "92dcbea108899e5d6e30d919b0744f90d9967e80c67a4ab5503ac16d54f62eb0";

pub(super) struct Installer {
    root: PathBuf,
}
struct Artifact {
    url: &'static str,
    sha: &'static str,
    name: &'static str,
}
impl Artifact {
    fn current() -> Result<Self, String> {
        let (url, sha, name) = match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => (
                "https://files.pythonhosted.org/packages/cc/df/147e5fa60cf8964bdcbc022cbd38502f91ea415bf82bed2c9335fcf9be9d/litert_lm_api-0.18.0-py3-none-macosx_12_0_arm64.whl",
                "9fd0c55835e469a035c1b75cde4797b26292963c2c36d9fcdfceb965ffa08a37", "liblitert-lm.dylib"),
            ("linux", "aarch64") => (
                "https://files.pythonhosted.org/packages/cf/f2/60707ac6860248e5f3601926c7cfe44794db350b60c1f14cb6e7e8874ae4/litert_lm_api-0.18.0-py3-none-manylinux_2_27_aarch64.whl",
                "d066db0c2bcd832b2b9cf8532b5fff385f7cff8562a1b482f8da0b51f810c47c", "liblitert-lm.so"),
            ("linux", "x86_64") => (
                "https://files.pythonhosted.org/packages/c9/8f/eb7a5203be1d48440c6b8d6e6382c3f744dd6d338fe400555718b4d695a1/litert_lm_api-0.18.0-py3-none-manylinux_2_27_x86_64.whl",
                "b64e2cf6d7dcb90ff094b74af595cc5d53faa07e0889f967d15df8d3e696b53c", "litert-lm.so"),
            ("windows", "x86_64") => (
                "https://files.pythonhosted.org/packages/2e/a4/842c858a90aac25a2ae6e4744197b22764a38fb35e45b15cf9c3b7570656/litert_lm_api-0.18.0-py3-none-win_amd64.whl",
                "eb02dc5d0fc6a894a664cfcc63e3aaf3100973ba2c9a6a7eebf4df8749a01038", "litert-lm.dll"),
            _ => return Err("Gemma local search is unavailable on this device architecture. Keyword search remains available.".into()),
        };
        Ok(Self { url, sha, name })
    }
}

impl Installer {
    pub(super) fn new(app_data: &Path) -> Self {
        Self {
            root: app_data.join("semantic/litert-0.18.0"),
        }
    }
    pub(super) fn supported() -> bool {
        Artifact::current().is_ok()
    }
    pub(super) fn library(&self) -> Option<PathBuf> {
        let artifact = Artifact::current().ok()?;
        // Native filenames differ between the platform wheels; resolve within
        // the verified publication only, never PATH or a system Python install.
        let dir = self.root.join("installed");
        find_library(&dir, artifact.name)
    }
    pub(super) fn verified_library(&self) -> Result<PathBuf, String> {
        let path = self.library().ok_or("LiteRT runtime is not installed")?;
        let expected = fs::read_to_string(self.root.join("installed/native.sha256"))
            .map_err(|_| "LiteRT verification receipt is missing; run setup again")?;
        if !matches_checksum(&path, expected.trim())? {
            return Err("LiteRT runtime failed checksum verification; run setup again".into());
        }
        Ok(path)
    }
    pub(super) fn install(&self, client: &Client) -> Result<PathBuf, String> {
        if let Ok(path) = self.verified_library() {
            return Ok(path);
        }
        let artifact = Artifact::current()?;
        let response = client
            .get(artifact.url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?;
        self.install_from(response)
    }
    fn install_from(&self, input: impl Read) -> Result<PathBuf, String> {
        let artifact = Artifact::current()?;
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let mut nonce = [0u8; 8];
        getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
        let stage = self
            .root
            .join(format!(".setup-{:016x}", u64::from_le_bytes(nonce)));
        fs::create_dir(&stage).map_err(|e| e.to_string())?;
        let result = (|| {
            let archive = stage.join("runtime.whl");
            save_verified(input, &archive, artifact.sha, 512 * 1024 * 1024)?;
            let extracted = stage.join("native");
            let mut zip =
                zip::ZipArchive::new(fs::File::open(&archive).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if zip.len() > 1024
                || (0..zip.len())
                    .map(|i| zip.by_index(i).map(|f| f.size()).unwrap_or(u64::MAX))
                    .try_fold(0u64, |a, b| a.checked_add(b))
                    .unwrap_or(u64::MAX)
                    > 1024 * 1024 * 1024
            {
                return Err("LiteRT package exceeds its extraction limits.".into());
            }
            zip.extract(&extracted).map_err(|e| e.to_string())?;
            let library = find_library(&extracted, artifact.name)
                .ok_or("LiteRT package has no native embedding library.")?;
            super::litert_ffi::verify_library(&library)?;
            fs::write(extracted.join("native.sha256"), checksum(&library)?)
                .map_err(|e| e.to_string())?;
            let relative = library
                .strip_prefix(&extracted)
                .map_err(|e| e.to_string())?
                .to_path_buf();
            let dest = self.root.join("installed");
            if dest.exists() {
                fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
            }
            fs::rename(&extracted, &dest).map_err(|e| e.to_string())?;
            Ok(dest.join(relative))
        })();
        let _ = fs::remove_dir_all(stage);
        result
    }
}

fn find_library(root: &Path, name: &str) -> Option<PathBuf> {
    for folder in [root.to_path_buf(), root.join("litert_lm")] {
        for candidate in [name.to_string(), format!("lib{name}")] {
            let path = folder.join(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

pub(super) fn save_verified(
    mut input: impl Read,
    path: &Path,
    sha: &str,
    limit: u64,
) -> Result<(), String> {
    let result = (|| {
        let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut bytes = 0u64;
        let mut buffer = [0; 64 * 1024];
        loop {
            let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            bytes += count as u64;
            if bytes > limit {
                return Err("Local search download exceeds its size limit.".into());
            }
            hash.update(&buffer[..count]);
            file.write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
        }
        if format!("{:x}", hash.finalize()) != sha {
            return Err(
                "Local search download failed checksum verification. Try setup again.".into(),
            );
        }
        file.sync_all().map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

fn checksum(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(super) fn matches_checksum(path: &Path, sha: &str) -> Result<bool, String> {
    Ok(path.is_file() && checksum(path)? == sha)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    #[test]
    fn failed_downloads_leave_no_partial_artifact() {
        let temp = crate::test_support::TestDir::new("litert-setup");
        let path = temp.path().join("partial");
        let sha = format!("{:x}", Sha256::digest(b"valid"));
        save_verified(&b"valid"[..], &path, &sha, 5).unwrap();
        assert!(matches_checksum(&path, &sha).unwrap());
        assert!(save_verified(&b"wrong"[..], &path, &sha, 5).is_err());
        assert!(!path.exists());
        assert!(save_verified(&b"valid"[..], &path, &sha, 4).is_err());
        assert!(!path.exists());
        let installer = Installer::new(temp.path());
        assert!(installer.install_from(&b"broken wheel"[..]).is_err());
        assert!(installer.library().is_none());
        assert_eq!(fs::read_dir(installer.root).unwrap().count(), 0);
    }
    pub(crate) fn install_fixture(app_data: &Path, wheel: &Path) -> PathBuf {
        Installer::new(app_data)
            .install_from(fs::File::open(wheel).unwrap())
            .unwrap()
    }
}
