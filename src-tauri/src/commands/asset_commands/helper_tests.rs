use super::*;
use crate::test_support::TestDir;
use std::fs;

#[test]
fn image_asset_metadata_versions_replacements_and_rejects_unsafe_paths() {
    let temp = TestDir::new("commands-image-metadata");
    let assets = temp.path().join("assets");
    fs::create_dir_all(assets.join("photos")).unwrap();
    let name = "photos/été #100%.svg";
    fs::write(assets.join(name), b"first").unwrap();
    let (path, first) = image_asset_metadata(&assets, name).unwrap();
    assert_eq!(path, assets.join(name).canonicalize().unwrap());
    assert_eq!(image_asset_metadata(&assets, name).unwrap().1, first);
    fs::write(assets.join(name), b"replacement").unwrap();
    assert_ne!(image_asset_metadata(&assets, name).unwrap().1, first);
    for invalid in ["../outside.svg", "/outside.svg", "photos\\outside.svg", "missing.svg"] {
        assert!(image_asset_metadata(&assets, invalid).is_err(), "{invalid}");
    }
}

#[test]
fn sanitize_asset_file_stem_normalizes_invalid_characters() {
    assert_eq!(
        sanitize_asset_file_stem(r#" ../Pasted:image*2024?.png "#),
        "Pasted image 2024"
    );
}

#[test]
fn asset_extension_from_mime_type_covers_common_images() {
    assert_eq!(asset_extension_from_mime_type("image/png"), Some("png"));
    assert_eq!(asset_extension_from_mime_type("image/jpeg"), Some("jpg"));
    assert_eq!(asset_extension_from_mime_type("application/json"), None);
}

#[test]
fn resolve_asset_image_path_accepts_contained_subfolders() {
    let temp = TestDir::new("commands-image-assets-subfolder");
    let assets_dir = temp.path().join("assets");
    fs::create_dir_all(assets_dir.join("photos")).expect("create subfolder");
    fs::write(assets_dir.join("photos/a b.png"), b"image").expect("write image");
    assert!(resolve_asset_image_path(&assets_dir, "photos/a b.png").is_ok());
    assert!(resolve_asset_image_path(&assets_dir, "/photos/a b.png").is_err());
    assert!(resolve_asset_image_path(&assets_dir, "photos/../../a.png").is_err());
}

#[cfg(unix)]
#[test]
fn resolve_asset_image_path_rejects_symlink_escape() {
    let temp = TestDir::new("commands-image-assets-symlink");
    let assets_dir = temp.path().join("assets");
    fs::create_dir_all(&assets_dir).expect("create assets");
    fs::write(temp.path().join("outside.png"), b"private").expect("outside file");
    std::os::unix::fs::symlink(
        temp.path().join("outside.png"),
        assets_dir.join("escape.png"),
    )
    .expect("symlink");
    assert!(resolve_asset_image_path(&assets_dir, "escape.png").is_err());
}

#[test]
fn read_image_asset_data_url_from_assets_dir_encodes_image_bytes() {
    let temp = TestDir::new("commands-image-assets-data-url");
    let assets_dir = temp.path().join("assets");
    fs::create_dir_all(&assets_dir).expect("create assets dir");
    fs::write(assets_dir.join("diagram.png"), [0_u8, 1, 2, 3]).expect("write asset");

    let data_url =
        read_image_asset_data_url_from_assets_dir(&assets_dir, "diagram.png").expect("data url");

    assert_eq!(data_url, "data:image/png;base64,AAECAw==");
}

#[test]
fn mime_type_from_asset_name_defaults_for_known_extensions() {
    assert_eq!(mime_type_from_asset_name("diagram.png"), "image/png");
    assert_eq!(mime_type_from_asset_name("photo.jpg"), "image/jpeg");
    assert_eq!(mime_type_from_asset_name("vector.svg"), "image/svg+xml");
}

#[test]
fn concurrent_same_name_image_writes_keep_both_payloads() {
    let root = TestDir::new("asset-concurrent-create");
    let barrier = std::sync::Barrier::new(2);
    let paths = std::thread::scope(|scope| {
        let write = |bytes: &'static [u8]| {
            let barrier = &barrier;
            let path = root.path();
            scope.spawn(move || {
                barrier.wait();
                super::write_new_image_asset(path, bytes, Some("pasted.png"), None).unwrap()
            })
        };
        let a = write(b"first");
        let b = write(b"second");
        (a.join().unwrap(), b.join().unwrap())
    });
    assert_ne!(paths.0, paths.1);
    assert_eq!(fs::read(paths.0).unwrap(), b"first");
    assert_eq!(fs::read(paths.1).unwrap(), b"second");
}

#[cfg(unix)]
#[test]
fn image_name_reservation_does_not_follow_dangling_symlinks() {
    let root = TestDir::new("asset-dangling-link");
    let target = root.path().join("absent.png");
    std::os::unix::fs::symlink(&target, root.path().join("pasted.png")).unwrap();
    let saved =
        super::write_new_image_asset(root.path(), b"new", Some("pasted.png"), None).unwrap();
    assert_eq!(saved.file_name().unwrap(), "pasted 1.png");
    assert!(!target.exists());
}
