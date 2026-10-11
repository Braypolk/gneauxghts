use super::*;

#[test]
fn a_successful_final_page_cannot_erase_an_earlier_unavailable_passage() {
    let vault = crate::test_support::TestVault::new("read-coverage-failure");
    let id = crate::test_support::save_and_finalize(
        &vault.state,
        "Unavailable middle".into(),
        "x".repeat(9100),
        None,
    )
    .unwrap()
    .unwrap()
    .note_id
    .unwrap();
    let mut session = EvidenceSession::default();
    let (first, _) = session
        .read_request(
            &vault.state,
            None,
            &HashSet::new(),
            ReadRequest {
                note_id: Some(id),
                ..Default::default()
            },
        )
        .unwrap();
    let missing = session
        .candidates
        .values()
        .find(|c| c.citation.location == "body" && c.citation.start == 2400)
        .unwrap()
        .citation
        .id
        .clone();
    session.candidates.remove(&missing);
    let mut cursor = first["nextCursor"].as_str().unwrap().to_string();
    let mut saw_failure = false;
    for _ in 0..8 {
        let (page, _) = session
            .read_request(
                &vault.state,
                None,
                &HashSet::new(),
                ReadRequest {
                    cursor: Some(cursor),
                    ..Default::default()
                },
            )
            .unwrap();
        saw_failure |= !page["failures"].as_array().unwrap().is_empty();
        assert_eq!(page["coverage"]["scope"], "canonical_note");
        if let Some(next) = page["nextCursor"].as_str() {
            cursor = next.into();
        } else {
            assert!(saw_failure);
            assert!(
                page["failures"].as_array().unwrap().is_empty(),
                "Expected a later successful final page"
            );
            assert_eq!(page["coverage"]["complete"], false);
            assert_eq!(page["coverage"]["wholeNoteComplete"], false);
            assert_eq!(page["delivery"]["complete"], false);
            return;
        }
    }
    panic!("Read did not terminate");
}
