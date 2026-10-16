use super::*;

fn app(root: &std::path::Path) -> tauri::App<tauri::test::MockRuntime> {
    let state = AppState::new(
        crate::semantic::SemanticState::new_disabled("disabled"),
        crate::app::EventBus::disabled(),
    )
    .unwrap();
    let domain =
        ChatDomain::new(root.to_path_buf(), crate::state::vault_data_dir_for(root)).unwrap();
    tauri::test::mock_builder()
        .manage(state)
        .manage(domain)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}
fn accepted(app: &tauri::App<tauri::test::MockRuntime>) -> Accepted {
    let created = crate::test_support::save_and_finalize(
        &app.state::<AppState>(),
        "Original".into(),
        "Before".into(),
        None,
    )
    .unwrap()
    .unwrap();
    let path = created.path.unwrap();
    let raw = fs::read_to_string(&path).unwrap();
    Accepted {
        id: "pi-review-location".into(),
        version: 1,
        kind: "update".into(),
        note_id: created.note_id,
        source_path: Some(path.clone()),
        path,
        title: "Original".into(),
        markdown: "Reviewed update".into(),
        base_hash: Some(crate::semantic::db::content_hash(&raw)),
        access: VaultAccess::Full,
        grants: vec![],
        promotion: None,
    }
}
#[test]
fn native_keep_conflicts_on_independent_move_even_with_unchanged_bytes() {
    let _guard = crate::test_support::lock_test_env();
    let data = crate::test_support::TestDir::new("pi-independent-location-data");
    let notes = crate::test_support::TestDir::new("pi-independent-location-vault");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(notes.path()).unwrap();
    let app = app(notes.path());
    let accepted = accepted(&app);
    let original = PathBuf::from(&accepted.path);
    let moved = notes.path().join("Independent move.md");
    fs::rename(&original, &moved).unwrap();
    let bytes = fs::read_to_string(&moved).unwrap();
    let result = publish(app.handle(), accepted, None).unwrap();
    assert_eq!(result.status, "conflict");
    assert!(result.message.unwrap().contains("location changed"));
    assert!(!original.exists());
    assert_eq!(fs::read_to_string(&moved).unwrap(), bytes);
    crate::state::set_notes_root_override(None).unwrap();
}
#[test]
fn native_keep_allows_bound_full_vault_relocation_before_first_publication() {
    let _guard = crate::test_support::lock_test_env();
    let data = crate::test_support::TestDir::new("pi-bound-location-data");
    let old = crate::test_support::TestDir::new("pi-bound-location-old");
    let destination = crate::test_support::TestDir::new("pi-bound-location-new");
    crate::state::initialize_app_data_dir(data.path().to_path_buf()).unwrap();
    crate::state::set_notes_root_override(Some(old.path().to_path_buf())).unwrap();
    crate::state::ensure_vault_scaffold(old.path()).unwrap();
    let first = app(old.path());
    crate::pi_prototype_relocation::Locations::bind(old.path()).unwrap();
    let accepted = accepted(&first);
    let serialized = serde_json::to_string(&accepted).unwrap();
    first
        .state::<AppState>()
        .note_timeline()
        .clean_close(old.path())
        .unwrap();
    drop(first);
    let moved = destination.path().join("Vault");
    fs::rename(old.path(), &moved).unwrap();
    crate::state::set_notes_root_override(Some(moved.clone())).unwrap();
    let reopened = app(&moved);
    let result = publish(reopened.handle(), accepted.clone(), None).unwrap();
    assert_eq!(result.status, "committed");
    assert_eq!(
        result.committed_markdown.as_deref(),
        Some("Reviewed update")
    );
    assert_eq!(serde_json::to_string(&accepted).unwrap(), serialized);
    assert_eq!(
        result.applied.unwrap().path,
        Some(moved.join("Original.md").to_string_lossy().into_owned())
    );
    crate::state::set_notes_root_override(None).unwrap();
}
