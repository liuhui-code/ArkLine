use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{params, Connection};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkspaceProjectTypeIdentity {
    pub path: String,
    pub name: String,
}

#[derive(Default)]
pub struct WorkspaceProjectTypeHierarchy {
    parents: HashMap<WorkspaceProjectTypeIdentity, Vec<WorkspaceProjectTypeIdentity>>,
    identities_by_location: HashMap<(String, String), WorkspaceProjectTypeIdentity>,
    identities_by_name: HashMap<String, Vec<WorkspaceProjectTypeIdentity>>,
}

impl WorkspaceProjectTypeHierarchy {
    pub fn load(connection: &Connection, root_key: &str) -> Result<Self, String> {
        let types = load_project_types(connection, root_key)?;
        let mut hierarchy = Self::default();
        for project_type in &types {
            let identity = WorkspaceProjectTypeIdentity {
                path: project_type.path.clone(),
                name: project_type.name.clone(),
            };
            hierarchy.identities_by_location.insert(
                (project_type.path.clone(), project_type.name.clone()),
                identity.clone(),
            );
            hierarchy.identities_by_location.insert(
                (
                    project_type.path.clone(),
                    project_type.qualified_name.clone(),
                ),
                identity.clone(),
            );
            hierarchy
                .identities_by_name
                .entry(project_type.name.clone())
                .or_default()
                .push(identity);
        }
        let import_targets = load_imported_type_targets(connection, root_key, &hierarchy)?;
        for project_type in types {
            let Some(child) = hierarchy.identity_at(&project_type.path, &project_type.name) else {
                continue;
            };
            for parent_name in supertype_names(project_type.signature.as_deref()) {
                let parent = import_targets
                    .get(&(project_type.path.clone(), parent_name.clone()))
                    .cloned()
                    .or_else(|| hierarchy.identity_at(&project_type.path, &parent_name))
                    .or_else(|| hierarchy.unique_identity(&parent_name));
                if let Some(parent) = parent {
                    hierarchy
                        .parents
                        .entry(child.clone())
                        .or_default()
                        .push(parent);
                }
            }
        }
        Ok(hierarchy)
    }

    pub fn inherited_types(
        &self,
        path: Option<&str>,
        type_name: &str,
    ) -> Vec<WorkspaceProjectTypeIdentity> {
        let Some(root) = path
            .and_then(|path| self.identity_at(path, type_name))
            .or_else(|| self.unique_identity(type_name))
        else {
            return Vec::new();
        };
        let mut queue = VecDeque::from([root.clone()]);
        let mut visited = HashSet::from([root]);
        let mut inherited = Vec::new();
        while let Some(current) = queue.pop_front() {
            for parent in self.parents.get(&current).into_iter().flatten() {
                if visited.insert(parent.clone()) {
                    inherited.push(parent.clone());
                    queue.push_back(parent.clone());
                }
            }
        }
        inherited
    }

    fn identity_at(&self, path: &str, name: &str) -> Option<WorkspaceProjectTypeIdentity> {
        self.identities_by_location
            .get(&(path.to_string(), name.to_string()))
            .cloned()
    }

    fn unique_identity(&self, name: &str) -> Option<WorkspaceProjectTypeIdentity> {
        let identities = self.identities_by_name.get(name)?;
        (identities.len() == 1).then(|| identities[0].clone())
    }
}

struct ProjectTypeRow {
    path: String,
    name: String,
    qualified_name: String,
    signature: Option<String>,
}

fn load_project_types(
    connection: &Connection,
    root_key: &str,
) -> Result<Vec<ProjectTypeRow>, String> {
    let mut statement = connection
        .prepare(
            "select path, name, qualified_name, signature
             from workspace_resolved_symbols
             where root_path = ?1
               and source = 'project'
               and kind in ('class', 'interface')
             order by path, line, column",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok(ProjectTypeRow {
                path: row.get(0)?,
                name: row.get(1)?,
                qualified_name: row.get(2)?,
                signature: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_imported_type_targets(
    connection: &Connection,
    root_key: &str,
    hierarchy: &WorkspaceProjectTypeHierarchy,
) -> Result<HashMap<(String, String), WorkspaceProjectTypeIdentity>, String> {
    let mut statement = connection
        .prepare(
            "select alias.path, alias.name, target.path, target.name
             from workspace_resolved_symbols alias
             join workspace_resolved_symbols target
               on target.root_path = alias.root_path
              and target.symbol_id = alias.target_symbol_id
             where alias.root_path = ?1
               and alias.source = 'import'
               and target.source = 'project'
               and target.kind in ('class', 'interface')",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut targets = HashMap::new();
    for row in rows {
        let (source_path, local_name, target_path, target_name) =
            row.map_err(|error| error.to_string())?;
        if let Some(identity) = hierarchy.identity_at(&target_path, &target_name) {
            targets.insert((source_path, local_name), identity);
        }
    }
    Ok(targets)
}

fn supertype_names(signature: Option<&str>) -> Vec<String> {
    let Some((_, after_extends)) = signature.and_then(|value| value.split_once(" extends ")) else {
        return Vec::new();
    };
    let clause = after_extends
        .split_once(" implements ")
        .map(|(value, _)| value)
        .unwrap_or(after_extends);
    let clause = clause
        .split_once('{')
        .map(|(value, _)| value)
        .unwrap_or(clause);
    clause
        .split(',')
        .filter_map(|value| {
            let value = value.trim();
            let end = value
                .find(|character: char| {
                    !character.is_ascii_alphanumeric() && character != '_' && character != '$'
                })
                .unwrap_or(value.len());
            value
                .get(..end)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::Connection;

    use crate::services::workspace_index_service::WorkspaceIndexRuntime;
    use crate::services::workspace_index_test_fixture_service::{
        create_empty_workspace, create_workspace_source_dir,
    };

    #[test]
    fn workspace_refresh_resolves_inherited_project_member_access() {
        let root = create_empty_workspace("reference-index-inherited-member-access");
        let source_dir = create_workspace_source_dir(&root);
        fs::write(
            source_dir.join("BaseService.ets"),
            "export class BaseService {\n  load() {}\n}\n",
        )
        .unwrap();
        fs::write(
            source_dir.join("UserService.ets"),
            [
                "import { BaseService } from \"./BaseService\";",
                "export class UserService extends BaseService {}",
            ]
            .join("\n"),
        )
        .unwrap();
        fs::write(
            source_dir.join("Index.ets"),
            [
                "import { UserService } from \"./UserService\";",
                "const service = new UserService();",
                "service.load();",
            ]
            .join("\n"),
        )
        .unwrap();
        let root_path = root.to_string_lossy().to_string();

        WorkspaceIndexRuntime::default()
            .refresh_workspace_index(&root_path)
            .unwrap();

        let connection = Connection::open(
            root.join(".arkline")
                .join("index")
                .join("workspace-catalog.sqlite"),
        )
        .unwrap();
        let (symbol_id, confidence): (Option<String>, String) = connection
            .query_row(
                "select symbol_id, confidence
                 from workspace_symbol_references
                 where kind = 'memberAccess' and name = 'load'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(confidence, "memberResolved");
        assert!(symbol_id
            .as_deref()
            .is_some_and(|value| value.contains(":method:BaseService.load:")));
        fs::remove_dir_all(root).unwrap();
    }
}
