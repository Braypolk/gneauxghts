use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
};

pub(crate) fn collect_markdown_files_recursively(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut directories = vec![root.to_path_buf()];
    let mut files = Vec::new();

    while let Some(directory) = directories.pop() {
        let mut entries = fs::read_dir(&directory)
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        entries.sort_by_key(|entry| entry.path());

        for entry in entries {
            let path = entry.path();
            let file_name = entry.file_name();
            let is_hidden = file_name
                .to_str()
                .is_some_and(|file_name| file_name.starts_with('.'));
            let file_type = entry.file_type().map_err(|err| err.to_string())?;

            if is_hidden {
                continue;
            }

            if file_type.is_dir() {
                directories.push(path);
                continue;
            }

            if file_type.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            {
                files.push(path);
            }
        }
    }

    files.sort();
    Ok(files)
}

pub(crate) fn unique_path_in_dir(
    directory: &Path,
    preferred_file_name: &OsStr,
    default_stem: &str,
) -> PathBuf {
    let preferred_path = directory.join(preferred_file_name);
    if !preferred_path.exists() {
        return preferred_path;
    }

    let preferred_path = Path::new(preferred_file_name);
    let stem = preferred_path
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or(default_stem);
    let extension = preferred_path
        .extension()
        .map(|value| value.to_string_lossy());

    for suffix in 1.. {
        let candidate_name = match extension.as_deref() {
            Some(extension) if !extension.is_empty() => format!("{stem} {suffix}.{extension}"),
            _ => format!("{stem} {suffix}"),
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    unreachable!("unbounded path search always returns")
}
