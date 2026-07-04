use crate::services::workspace_symbol_resolution_insert_service::ResolvedSymbolInserter;
use crate::services::workspace_symbol_resolution_model_service::{
    ExportBindingRow, ImportBindingRow, StubDeclarationRow,
};
use crate::services::workspace_symbol_resolution_service::symbol_id;

pub struct AliasTarget {
    pub symbol_id: String,
    pub kind: String,
    pub container: Option<String>,
    pub signature: Option<String>,
    pub visibility: Option<String>,
}

pub struct ExportAliasTarget {
    pub path: String,
    pub exported_name: String,
    pub target_symbol_id: String,
    pub kind: String,
    pub container: Option<String>,
    pub signature: Option<String>,
    pub visibility: Option<String>,
}

pub fn insert_import_alias_symbol(
    inserter: &mut ResolvedSymbolInserter,
    root_key: &str,
    id: &str,
    import: &ImportBindingRow,
    target: &AliasTarget,
    indexed_generation: u64,
) -> Result<(), String> {
    inserter.insert_fields(
        root_key,
        id,
        &import.from_path,
        &import.local_name,
        &import.local_name,
        &target.kind,
        target.container.as_deref(),
        target.signature.as_deref(),
        target.visibility.as_deref(),
        Some(&target.symbol_id),
        "import",
        import.line,
        import.column,
        indexed_generation,
    )
}

pub fn insert_export_alias_symbol(
    inserter: &mut ResolvedSymbolInserter,
    root_key: &str,
    id: &str,
    export: &ExportBindingRow,
    target: &StubDeclarationRow,
    indexed_generation: u64,
) -> Result<(), String> {
    let target_symbol_id = symbol_id(target);
    inserter.insert_fields(
        root_key,
        id,
        &export.from_path,
        &export.exported_name,
        &export.exported_name,
        &target.kind,
        target.container.as_deref(),
        Some(&target.signature),
        target.visibility.as_deref(),
        Some(&target_symbol_id),
        "export",
        export.line,
        export.column,
        indexed_generation,
    )
}
