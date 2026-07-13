use crate::services::workspace_arkts_stub_parser_service::parse_arkts_file_stub;

#[test]
fn parses_struct_class_function_method_and_property_stubs() {
    let stub = parse_arkts_file_stub(
        "entry/src/main/ets/pages/Index.ets",
        r#"
struct Index { build() {} }

class UserService {
  name: string;
  loadUser(id: string) {}
}

function bootstrap() {}
"#,
    );

    let names = stub
        .declarations
        .iter()
        .map(|declaration| {
            (
                declaration.kind.as_str(),
                declaration.qualified_name.as_str(),
            )
        })
        .collect::<Vec<_>>();

    assert!(names.contains(&("struct", "Index")));
    assert!(names.contains(&("method", "Index.build")));
    assert!(names.contains(&("class", "UserService")));
    assert!(names.contains(&("property", "UserService.name")));
    assert!(names.contains(&("method", "UserService.loadUser")));
    assert!(names.contains(&("function", "bootstrap")));
}

#[test]
fn parses_visibility_modifiers_and_signatures() {
    let stub = parse_arkts_file_stub(
        "entry/src/main/ets/services/UserService.ets",
        r#"
export class UserService {
  private async loadUser(id: string): Promise<User> {}
  public readonly displayName: string;
}
"#,
    );

    let service = stub
        .declarations
        .iter()
        .find(|declaration| declaration.name == "UserService")
        .expect("class declaration");
    assert_eq!(service.modifiers, vec!["export"]);

    let method = stub
        .declarations
        .iter()
        .find(|declaration| declaration.qualified_name == "UserService.loadUser")
        .expect("method declaration");
    assert_eq!(method.visibility.as_deref(), Some("private"));
    assert_eq!(method.modifiers, vec!["private", "async"]);
    assert_eq!(
        method.signature,
        "private async loadUser(id: string): Promise<User>"
    );

    let property = stub
        .declarations
        .iter()
        .find(|declaration| declaration.qualified_name == "UserService.displayName")
        .expect("property declaration");
    assert_eq!(property.visibility.as_deref(), Some("public"));
    assert_eq!(property.modifiers, vec!["public", "readonly"]);
}

#[test]
fn parses_namespace_containers_with_qualified_member_symbols() {
    let stub = parse_arkts_file_stub(
        "entry/src/main/ets/services/Api.ets",
        r#"
export namespace Api {
  export class Client {
    static create(): Client {}
    refresh() {}
  }
}
"#,
    );

    let names = stub
        .declarations
        .iter()
        .map(|declaration| {
            (
                declaration.kind.as_str(),
                declaration.qualified_name.as_str(),
                declaration.container.as_deref(),
            )
        })
        .collect::<Vec<_>>();

    assert!(names.contains(&("namespace", "Api", None)));
    assert!(names.contains(&("class", "Api.Client", Some("Api"))));
    assert!(names.contains(&("method", "Api.Client.create", Some("Api.Client"))));
    assert!(names.contains(&("method", "Api.Client.refresh", Some("Api.Client"))));
}

#[test]
fn parses_import_and_export_aliases() {
    let stub = parse_arkts_file_stub(
        "entry/src/main/ets/pages/Index.ets",
        r#"
import { Foo as Bar, Baz } from "./foo";
import type { User } from "../models/user";
export { Bar as PublicBar } from "./foo";
export default struct Main {}
"#,
    );

    assert!(stub.imports.iter().any(|import| {
        import.source_module == "./foo"
            && import.imported_name.as_deref() == Some("Foo")
            && import.local_name == "Bar"
            && !import.is_type_only
    }));
    assert!(stub.imports.iter().any(|import| {
        import.source_module == "../models/user"
            && import.imported_name.as_deref() == Some("User")
            && import.local_name == "User"
            && import.is_type_only
    }));
    assert!(stub.exports.iter().any(|export| {
        export.source_module.as_deref() == Some("./foo")
            && export.local_name.as_deref() == Some("Bar")
            && export.exported_name == "PublicBar"
    }));
    assert!(stub.exports.iter().any(|export| {
        export.exported_name == "default"
            && export.local_name.as_deref() == Some("Main")
            && export.is_default
    }));
}

#[test]
fn attaches_decorators_to_next_declaration() {
    let stub = parse_arkts_file_stub(
        "entry/src/main/ets/pages/Index.ets",
        r#"
@Entry
@Component
struct Index {
  @Builder
  header() {}
}
"#,
    );

    let page = stub
        .declarations
        .iter()
        .find(|declaration| declaration.name == "Index")
        .expect("struct declaration");
    assert_eq!(page.decorators, vec!["@Entry", "@Component"]);

    let method = stub
        .declarations
        .iter()
        .find(|declaration| declaration.qualified_name == "Index.header")
        .expect("decorated method");
    assert_eq!(method.decorators, vec!["@Builder"]);
}

#[test]
fn ignores_call_expressions_inside_member_bodies() {
    let stub = parse_arkts_file_stub(
        "entry/src/main/ets/pages/Index.ets",
        r#"
struct Index {
  build() {
    Text("hello")
    this.renderFooter()
  }
  renderFooter() {}
}
"#,
    );

    let names = stub
        .declarations
        .iter()
        .map(|declaration| declaration.qualified_name.as_str())
        .collect::<Vec<_>>();

    assert!(names.contains(&"Index"));
    assert!(names.contains(&"Index.build"));
    assert!(names.contains(&"Index.renderFooter"));
    assert!(!names.contains(&"Index.Text"));
}

#[test]
fn records_parse_errors_for_malformed_source_without_panicking() {
    let stub = parse_arkts_file_stub(
        "entry/src/main/ets/pages/Broken.ets",
        r#"
struct Broken {
  build() {
"#,
    );

    assert!(stub
        .parse_errors
        .iter()
        .any(|error| error.message == "Unclosed block"));
    assert!(stub
        .declarations
        .iter()
        .any(|declaration| declaration.name == "Broken"));
}
