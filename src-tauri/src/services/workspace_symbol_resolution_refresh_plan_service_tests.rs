use crate::services::workspace_symbol_resolution_refresh_plan_service::{
    plan_symbol_resolution_refresh, SymbolResolutionRefreshPlan,
};

#[test]
fn plans_declarations_only_for_pure_declaration_path_chunks() {
    assert_eq!(
        plan_symbol_resolution_refresh(false),
        SymbolResolutionRefreshPlan::DeclarationsOnly
    );
}

#[test]
fn plans_binding_resolution_when_imports_or_re_exports_are_present() {
    assert_eq!(
        plan_symbol_resolution_refresh(true),
        SymbolResolutionRefreshPlan::IncludeBindings
    );
}
