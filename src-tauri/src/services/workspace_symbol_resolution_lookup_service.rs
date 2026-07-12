use std::collections::HashMap;

use crate::services::workspace_symbol_resolution_alias_service::{AliasTarget, ExportAliasTarget};
use crate::services::workspace_symbol_resolution_model_service::StubDeclarationRow;
use crate::services::workspace_symbol_resolution_service::symbol_id;

pub(crate) fn declaration_lookup(
    declarations: &[StubDeclarationRow],
) -> HashMap<(String, String), &StubDeclarationRow> {
    declarations
        .iter()
        .map(|declaration| {
            (
                (declaration.path.clone(), declaration.name.clone()),
                declaration,
            )
        })
        .collect()
}

pub(crate) fn export_alias_lookup(
    aliases: Vec<ExportAliasTarget>,
) -> HashMap<(String, String), ExportAliasTarget> {
    aliases
        .into_iter()
        .map(|alias| ((alias.path.clone(), alias.exported_name.clone()), alias))
        .collect()
}

pub(crate) fn import_alias_target(
    declaration: Option<&StubDeclarationRow>,
    export_alias: Option<&ExportAliasTarget>,
) -> Option<AliasTarget> {
    if let Some(declaration) = declaration {
        return Some(AliasTarget {
            symbol_id: symbol_id(declaration),
            kind: declaration.kind.clone(),
            container: declaration.container.clone(),
            signature: Some(declaration.signature.clone()),
            visibility: declaration.visibility.clone(),
        });
    }
    export_alias.map(|alias| AliasTarget {
        symbol_id: alias.target_symbol_id.clone(),
        kind: alias.kind.clone(),
        container: alias.container.clone(),
        signature: alias.signature.clone(),
        visibility: alias.visibility.clone(),
    })
}
