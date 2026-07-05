use crate::services::workspace_reference_identifier_index_service::{
    content_may_reference_aliases, ReferenceAliasTargets,
};

#[test]
fn content_may_reference_aliases_is_false_when_path_alias_names_are_absent() {
    let mut aliases = ReferenceAliasTargets::new();
    aliases.insert(
        (
            "C:\\workspace\\src\\Entry.ets".to_string(),
            "Service".to_string(),
        ),
        "symbol:Service".to_string(),
    );
    aliases.insert(
        (
            "C:\\workspace\\src\\Other.ets".to_string(),
            "Entry".to_string(),
        ),
        "symbol:Entry".to_string(),
    );

    assert!(!content_may_reference_aliases(
        "C:\\workspace\\src\\Entry.ets",
        "const count = 1;\nText(\"hello\");",
        &aliases,
    ));
}

#[test]
fn content_may_reference_aliases_is_true_for_alias_names_on_the_same_path() {
    let mut aliases = ReferenceAliasTargets::new();
    aliases.insert(
        (
            "C:\\workspace\\src\\Entry.ets".to_string(),
            "Service".to_string(),
        ),
        "symbol:Service".to_string(),
    );

    assert!(content_may_reference_aliases(
        "C:\\workspace\\src\\Entry.ets",
        "const service = new Service();",
        &aliases,
    ));
}
