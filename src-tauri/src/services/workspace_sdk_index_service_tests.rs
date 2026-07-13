use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_index_diagnostics_service::inspect_workspace_index;
use crate::services::workspace_sdk_index_service::{
    index_workspace_sdk_symbol_chunk, index_workspace_sdk_symbols, query_workspace_sdk_symbols,
};

fn unique_temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-sdk-index-{name}-{suffix}"))
}

#[test]
fn indexes_queries_and_reports_sdk_api_symbols() {
    let workspace = unique_temp_dir("workspace");
    let sdk_root = workspace.join("openharmony");
    let arkui_dir = sdk_root.join("ets").join("arkui");
    fs::create_dir_all(&arkui_dir).unwrap();
    fs::create_dir_all(sdk_root.join("toolchains")).unwrap();
    fs::write(
        arkui_dir.join("component.d.ts"),
        "declare class Text {\n  width(value: Length): Text;\n  fontSize(value: number): Text;\n}\ndeclare function Column(): void;\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();

    let summary = index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();
    let matches = query_workspace_sdk_symbols(&workspace_path, "width", 8).unwrap();
    let diagnostics = inspect_workspace_index(&workspace_path).unwrap();

    assert_eq!(summary.symbol_count, 4);
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].source, "api");
    assert_eq!(matches[0].kind, "method");
    assert_eq!(matches[0].title, "width");
    assert!(matches[0].id.starts_with("sdk:"));
    assert!(matches[0].id.contains(":method:Text:width:"));
    assert_eq!(diagnostics.schema_versions.get("sdk"), Some(&1));
    assert_eq!(diagnostics.sdk_symbol_count, 4);

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn ranks_sdk_api_symbols_by_exact_prefix_then_contains_match() {
    let workspace = unique_temp_dir("ranking");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::create_dir_all(sdk_root.join("toolchains")).unwrap();
    fs::write(
        sdk_root.join("ets").join("layout.d.ts"),
        "declare class Layout {\n  minWidth(value: Length): Layout;\n  width(value: Length): Layout;\n  widthPercent(value: number): Layout;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let matches = query_workspace_sdk_symbols(&workspace_path, "width", 8).unwrap();

    assert_eq!(
        matches
            .iter()
            .map(|candidate| candidate.title.as_str())
            .collect::<Vec<_>>(),
        vec!["width", "widthPercent", "minWidth"]
    );
    assert!(matches[0].score > matches[1].score);
    assert!(matches[1].score > matches[2].score);

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn ranks_sdk_api_symbols_by_camel_case_acronym_before_loose_fuzzy_matches() {
    let workspace = unique_temp_dir("camel-case-ranking");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::create_dir_all(sdk_root.join("toolchains")).unwrap();
    fs::write(
        sdk_root.join("ets").join("types.d.ts"),
        "declare class Tower {}\ndeclare class TextDisplayWidth {}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let matches = query_workspace_sdk_symbols(&workspace_path, "tdw", 8).unwrap();

    assert_eq!(matches[0].title, "TextDisplayWidth");

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn ranks_sdk_api_symbols_with_container_qualified_queries() {
    let workspace = unique_temp_dir("container-ranking");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::create_dir_all(sdk_root.join("toolchains")).unwrap();
    fs::write(
        sdk_root.join("ets").join("components.d.ts"),
        "declare class Button {\n  width(value: Length): Button;\n}\ndeclare class Text {\n  width(value: Length): Text;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let matches = query_workspace_sdk_symbols(&workspace_path, "Text width", 8).unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].title, "width");
    assert!(matches[0].subtitle.starts_with("Text ·"));

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn indexes_sdk_members_after_common_typescript_modifiers() {
    let workspace = unique_temp_dir("member-modifiers");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("modifiers.d.ts"),
        "declare class ModifierDemo {\n  public static width(value: Length): ModifierDemo;\n  readonly size: number;\n  protected onClick(): void;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let width = query_workspace_sdk_symbols(&workspace_path, "ModifierDemo width", 8).unwrap();
    let size = query_workspace_sdk_symbols(&workspace_path, "ModifierDemo size", 8).unwrap();
    let on_click = query_workspace_sdk_symbols(&workspace_path, "ModifierDemo onClick", 8).unwrap();

    assert_eq!(width.len(), 1);
    assert_eq!(width[0].title, "width");
    assert_eq!(width[0].kind, "method");
    assert_eq!(size.len(), 1);
    assert_eq!(size[0].title, "size");
    assert_eq!(size[0].kind, "property");
    assert!(on_click.is_empty());

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn sdk_index_skips_private_protected_and_internal_symbols() {
    let workspace = unique_temp_dir("api-only-visibility");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets").join("component")).unwrap();
    fs::write(
        sdk_root.join("ets").join("component").join("common.d.ts"),
        [
            "export interface Button {",
            "  width(value: number): Button;",
            "  private privateInternal(): void;",
            "  protected protectedInternal(): void;",
            "  /** @internal */",
            "  debugOnly(): void;",
            "}",
            "class InternalImpl {",
            "  secret(): void;",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();

    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    assert_eq!(
        query_workspace_sdk_symbols(&workspace_path, "Button width", 8)
            .unwrap()
            .len(),
        1
    );
    assert!(
        query_workspace_sdk_symbols(&workspace_path, "privateInternal", 8)
            .unwrap()
            .is_empty()
    );
    assert!(
        query_workspace_sdk_symbols(&workspace_path, "protectedInternal", 8)
            .unwrap()
            .is_empty()
    );
    assert!(query_workspace_sdk_symbols(&workspace_path, "debugOnly", 8)
        .unwrap()
        .is_empty());
    assert!(query_workspace_sdk_symbols(&workspace_path, "secret", 8)
        .unwrap()
        .is_empty());

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn sdk_api_index_can_index_a_single_chunk() {
    let workspace = unique_temp_dir("sdk-api-chunk");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets").join("component")).unwrap();
    for index in 0..3 {
        fs::write(
            sdk_root
                .join("ets")
                .join("component")
                .join(format!("api{index}.d.ts")),
            format!("export interface Api{index} {{ method{index}(): void; }}"),
        )
        .unwrap();
    }
    let files = vec![
        sdk_root
            .join("ets")
            .join("component")
            .join("api0.d.ts")
            .to_string_lossy()
            .to_string(),
        sdk_root
            .join("ets")
            .join("component")
            .join("api1.d.ts")
            .to_string_lossy()
            .to_string(),
    ];
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();

    let summary =
        index_workspace_sdk_symbol_chunk(&workspace_path, &sdk_path, "test-sdk", &files, true)
            .unwrap();

    assert_eq!(summary.indexed_files, 2);
    assert!(summary.symbol_count >= 2);
    assert!(query_workspace_sdk_symbols(&workspace_path, "method2", 8)
        .unwrap()
        .is_empty());

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn classifies_generic_and_optional_sdk_methods() {
    let workspace = unique_temp_dir("generic-optional-members");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("generic.d.ts"),
        "declare class GenericDemo {\n  getValue<T>(): T;\n  onReady?(): void;\n  optionalValue?: string;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let get_value =
        query_workspace_sdk_symbols(&workspace_path, "GenericDemo getValue", 8).unwrap();
    let on_ready = query_workspace_sdk_symbols(&workspace_path, "GenericDemo onReady", 8).unwrap();
    let optional_value =
        query_workspace_sdk_symbols(&workspace_path, "GenericDemo optionalValue", 8).unwrap();

    assert_eq!(get_value.len(), 1);
    assert_eq!(get_value[0].kind, "method");
    assert_eq!(on_ready.len(), 1);
    assert_eq!(on_ready[0].kind, "method");
    assert_eq!(optional_value.len(), 1);
    assert_eq!(optional_value[0].kind, "property");

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn indexes_sdk_symbols_inside_namespaces_with_qualified_containers() {
    let workspace = unique_temp_dir("namespace-members");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("namespace.d.ts"),
        "declare namespace ArkUI {\n  function animateTo(value: number): void;\n  class Text {\n    width(value: Length): Text;\n  }\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let animate = query_workspace_sdk_symbols(&workspace_path, "ArkUI animateTo", 8).unwrap();
    let width = query_workspace_sdk_symbols(&workspace_path, "ArkUI Text width", 8).unwrap();

    assert_eq!(animate.len(), 1);
    assert_eq!(animate[0].title, "animateTo");
    assert_eq!(animate[0].kind, "function");
    assert!(animate[0].subtitle.starts_with("ArkUI"));
    assert_eq!(width.len(), 1);
    assert_eq!(width[0].title, "width");
    assert_eq!(width[0].kind, "method");
    assert!(width[0].subtitle.starts_with("ArkUI.Text"));

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn indexes_sdk_type_alias_declarations() {
    let workspace = unique_temp_dir("type-aliases");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("types.d.ts"),
        "declare type Length = number | string;\ndeclare namespace ArkUI {\n  type ResourceColor = string | number;\n}\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let length = query_workspace_sdk_symbols(&workspace_path, "Length", 8).unwrap();
    let resource_color =
        query_workspace_sdk_symbols(&workspace_path, "ArkUI ResourceColor", 8).unwrap();

    assert_eq!(length.len(), 1);
    assert_eq!(length[0].title, "Length");
    assert_eq!(length[0].kind, "type");
    assert_eq!(resource_color.len(), 1);
    assert_eq!(resource_color[0].title, "ResourceColor");
    assert_eq!(resource_color[0].kind, "type");
    assert!(resource_color[0].subtitle.starts_with("ArkUI"));

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn indexes_exported_sdk_declarations_and_members() {
    let workspace = unique_temp_dir("exported-declarations");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("exports.d.ts"),
        "export declare interface ExportedOptions {\n  enabled?: boolean;\n}\nexport declare class ExportedWidget {\n  export static create(): ExportedWidget;\n}\nexport declare function makeWidget(): ExportedWidget;\nexport type ExportedLength = number;\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let options = query_workspace_sdk_symbols(&workspace_path, "ExportedOptions", 8).unwrap();
    let create = query_workspace_sdk_symbols(&workspace_path, "ExportedWidget create", 8).unwrap();
    let make_widget = query_workspace_sdk_symbols(&workspace_path, "makeWidget", 8).unwrap();
    let exported_length =
        query_workspace_sdk_symbols(&workspace_path, "ExportedLength", 8).unwrap();

    assert_eq!(options.len(), 1);
    assert_eq!(options[0].kind, "interface");
    assert_eq!(create.len(), 1);
    assert_eq!(create[0].kind, "method");
    assert_eq!(make_widget.len(), 1);
    assert_eq!(make_widget[0].kind, "function");
    assert_eq!(exported_length.len(), 1);
    assert_eq!(exported_length[0].kind, "type");

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn indexes_members_from_single_line_sdk_type_declarations() {
    let workspace = unique_temp_dir("single-line-types");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("single-line.d.ts"),
        "export declare interface InlineOptions { enabled?: boolean; }\nexport declare class InlineWidget { create(): InlineWidget; }\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let enabled = query_workspace_sdk_symbols(&workspace_path, "InlineOptions enabled", 8).unwrap();
    let create = query_workspace_sdk_symbols(&workspace_path, "InlineWidget create", 8).unwrap();

    assert_eq!(enabled.len(), 1);
    assert_eq!(enabled[0].kind, "property");
    assert_eq!(create.len(), 1);
    assert_eq!(create[0].kind, "method");

    fs::remove_dir_all(workspace).unwrap();
}

#[test]
fn indexes_sdk_enum_members_with_qualified_containers() {
    let workspace = unique_temp_dir("enum-members");
    let sdk_root = workspace.join("openharmony");
    fs::create_dir_all(sdk_root.join("ets")).unwrap();
    fs::write(
        sdk_root.join("ets").join("enums.d.ts"),
        "declare enum FontWeight {\n  Normal = 'normal',\n  Bold = 'bold',\n}\nexport declare enum InlineAlignment { Start, Center, End }\n",
    )
    .unwrap();
    let workspace_path = workspace.to_string_lossy().to_string();
    let sdk_path = sdk_root.to_string_lossy().to_string();
    index_workspace_sdk_symbols(&workspace_path, &sdk_path, "test-sdk").unwrap();

    let bold = query_workspace_sdk_symbols(&workspace_path, "FontWeight Bold", 8).unwrap();
    let center = query_workspace_sdk_symbols(&workspace_path, "InlineAlignment Center", 8).unwrap();

    assert_eq!(bold.len(), 1);
    assert_eq!(bold[0].kind, "property");
    assert!(bold[0].subtitle.starts_with("FontWeight"));
    assert_eq!(center.len(), 1);
    assert_eq!(center[0].kind, "property");
    assert!(center[0].subtitle.starts_with("InlineAlignment"));

    fs::remove_dir_all(workspace).unwrap();
}
