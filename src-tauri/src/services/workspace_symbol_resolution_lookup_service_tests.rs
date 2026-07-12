use crate::services::workspace_symbol_resolution_alias_service::ExportAliasTarget;
use crate::services::workspace_symbol_resolution_lookup_service::{
    declaration_lookup, export_alias_lookup, import_alias_target,
};
use crate::services::workspace_symbol_resolution_model_service::StubDeclarationRow;

fn declaration(path: &str, name: &str) -> StubDeclarationRow {
    StubDeclarationRow {
        path: path.to_string(),
        name: name.to_string(),
        qualified_name: name.to_string(),
        kind: "class".to_string(),
        container: None,
        signature: "class".to_string(),
        visibility: Some("public".to_string()),
        line: 7,
        column: 3,
    }
}

#[test]
fn declaration_lookup_indexes_declarations_by_path_and_name() {
    let declarations = vec![declaration("src\\Entry.ets", "Entry")];
    let lookup = declaration_lookup(&declarations);

    let found = lookup
        .get(&("src\\Entry.ets".to_string(), "Entry".to_string()))
        .expect("declaration should be indexed");
    assert_eq!(found.qualified_name, "Entry");
}

#[test]
fn import_alias_target_prefers_direct_declaration_over_export_alias() {
    let declarations = vec![declaration("src\\Target.ets", "Target")];
    let alias = ExportAliasTarget {
        path: "src\\Barrel.ets".to_string(),
        exported_name: "Target".to_string(),
        target_symbol_id: "export-target".to_string(),
        kind: "class".to_string(),
        container: None,
        signature: Some("alias".to_string()),
        visibility: Some("public".to_string()),
    };

    let target = import_alias_target(Some(&declarations[0]), Some(&alias))
        .expect("direct declaration should resolve");

    assert!(target.symbol_id.contains("src\\Target.ets"));
    assert_eq!(target.signature.as_deref(), Some("class"));
}

#[test]
fn export_alias_lookup_indexes_aliases_by_path_and_exported_name() {
    let aliases = export_alias_lookup(vec![ExportAliasTarget {
        path: "src\\Barrel.ets".to_string(),
        exported_name: "Entry".to_string(),
        target_symbol_id: "target".to_string(),
        kind: "class".to_string(),
        container: None,
        signature: Some("class".to_string()),
        visibility: Some("public".to_string()),
    }]);

    let found = aliases
        .get(&("src\\Barrel.ets".to_string(), "Entry".to_string()))
        .expect("export alias should be indexed");
    assert_eq!(found.target_symbol_id, "target");
}
