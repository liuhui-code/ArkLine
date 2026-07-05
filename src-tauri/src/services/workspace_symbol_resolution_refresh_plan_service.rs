#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SymbolResolutionRefreshPlan {
    DeclarationsOnly,
    IncludeBindings,
}

pub(crate) fn plan_symbol_resolution_refresh(
    has_import_or_export_bindings: bool,
) -> SymbolResolutionRefreshPlan {
    if has_import_or_export_bindings {
        SymbolResolutionRefreshPlan::IncludeBindings
    } else {
        SymbolResolutionRefreshPlan::DeclarationsOnly
    }
}
