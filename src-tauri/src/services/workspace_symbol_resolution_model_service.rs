pub(crate) struct StubDeclarationRow {
    pub(crate) path: String,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) qualified_name: String,
    pub(crate) container: Option<String>,
    pub(crate) signature: String,
    pub(crate) visibility: Option<String>,
    pub(crate) line: i64,
    pub(crate) column: i64,
}

pub(crate) struct ImportBindingRow {
    pub(crate) from_path: String,
    pub(crate) source_module: String,
    pub(crate) imported_name: String,
    pub(crate) local_name: String,
    pub(crate) line: i64,
    pub(crate) column: i64,
    pub(crate) to_path: String,
}

pub(crate) struct UnresolvedImportRow {
    pub(crate) from_path: String,
    pub(crate) source_module: String,
    pub(crate) local_name: String,
    pub(crate) line: i64,
    pub(crate) column: i64,
}

pub(crate) struct ExportBindingRow {
    pub(crate) from_path: String,
    pub(crate) source_module: String,
    pub(crate) local_name: String,
    pub(crate) exported_name: String,
    pub(crate) line: i64,
    pub(crate) column: i64,
    pub(crate) to_path: String,
}
