use std::fs;
use std::path::{Path, PathBuf};

use crate::models::build_project::{HarmonyBuildProject, HarmonyProductSdk, HarmonyProductSigning};

use super::build_profile_parser_service::{
    array_objects, named_array_body, named_object_body, named_profile_values, scalar_field,
    string_field,
};

#[derive(Clone)]
struct ProjectModuleDeclaration {
    name: String,
    src_path: String,
}

pub fn find_harmony_build_artifacts(
    root_path: &str,
    target: &str,
    module_name: Option<&str>,
    product: &str,
) -> Result<Vec<String>, String> {
    let project_root = PathBuf::from(root_path);
    let build_root = if target == "app" {
        project_root.join("build")
    } else {
        let module =
            module_name.ok_or_else(|| "A module is required for this build target".to_string())?;
        declared_module_root(&project_root, module)
            .unwrap_or_else(|| project_root.join(module))
            .join("build")
    };
    if !build_root.is_dir() {
        return Ok(Vec::new());
    }

    let preferred_root = build_root.join(product).join("outputs");
    let search_root = if preferred_root.is_dir() {
        preferred_root
    } else {
        build_root
    };
    let mut artifacts = Vec::new();
    collect_artifacts(&search_root, target, 0, &mut artifacts)?;
    artifacts.sort();
    artifacts.dedup();
    Ok(artifacts)
}

fn declared_module_root(root: &Path, module_name: &str) -> Option<PathBuf> {
    let profile_content = fs::read_to_string(root.join("build-profile.json5")).ok()?;
    let module = declared_project_modules(&profile_content)
        .into_iter()
        .find(|module| module.name == module_name)?;
    let src_path = PathBuf::from(module.src_path);
    let module_root = if src_path.is_absolute() {
        src_path
    } else {
        root.join(src_path)
    };
    Some(module_root.components().collect())
}

fn collect_artifacts(
    directory: &Path,
    target: &str,
    depth: usize,
    artifacts: &mut Vec<String>,
) -> Result<(), String> {
    if depth > 6 {
        return Ok(());
    }
    for entry in fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_artifacts(&path, target, depth + 1, artifacts)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some(target)
            && entry
                .metadata()
                .map(|metadata| metadata.len() > 0)
                .unwrap_or(false)
        {
            artifacts.push(path.to_string_lossy().to_string());
        }
    }
    Ok(())
}

pub fn inspect_harmony_build_project(root_path: &str) -> Result<HarmonyBuildProject, String> {
    let selected_path = PathBuf::from(root_path);
    if !selected_path.exists() {
        return Err(format!(
            "Project path does not exist: {}",
            selected_path.display()
        ));
    }
    let selected_dir = if selected_path.is_file() {
        match selected_path.parent() {
            Some(parent) => parent.to_path_buf(),
            None => selected_path.clone(),
        }
    } else {
        selected_path.clone()
    };
    let root = find_harmony_project_root(&selected_dir);

    let has_unix_wrapper = root.join("hvigorw").is_file();
    let has_windows_wrapper = root.join("hvigorw.bat").is_file();
    let has_hvigor_file = root.join("hvigorfile.ts").is_file();
    let has_build_profile = root.join("build-profile.json5").is_file();
    let has_oh_package = root.join("oh-package.json5").is_file();
    let profile_content = fs::read_to_string(root.join("build-profile.json5")).unwrap_or_default();
    let module_declarations = declared_project_modules(&profile_content);
    let modules = discover_modules(&root, &profile_content, &module_declarations)?;
    let mut products = named_profile_values(&profile_content, "products");
    if products.is_empty() {
        products.push("default".to_string());
    }
    let is_harmony_project =
        has_hvigor_file || has_build_profile || has_oh_package || !modules.is_empty();
    let default_module = selected_declared_module(&root, &selected_path, &module_declarations)
        .or_else(|| {
            modules
                .iter()
                .find(|module_name| module_name.as_str() == "entry")
                .cloned()
        })
        .or_else(|| modules.first().cloned());
    let default_product = products
        .iter()
        .find(|product| product.as_str() == "default")
        .cloned()
        .or_else(|| products.first().cloned());
    let product_signing = inspect_product_signing(&root, &profile_content, &products);
    let product_sdks = inspect_product_sdks(&profile_content, &products);

    Ok(HarmonyBuildProject {
        root_path: root.to_string_lossy().to_string(),
        is_harmony_project,
        has_hvigor_wrapper: has_unix_wrapper || has_windows_wrapper,
        hvigor_wrapper_command: if cfg!(windows) && has_windows_wrapper {
            Some("hvigorw.bat".to_string())
        } else if !cfg!(windows) && has_unix_wrapper {
            Some("./hvigorw".to_string())
        } else if has_windows_wrapper {
            Some("hvigorw.bat".to_string())
        } else if has_unix_wrapper {
            Some("./hvigorw".to_string())
        } else {
            None
        },
        has_hvigor_file,
        has_build_profile,
        has_oh_package,
        modules,
        default_module,
        products,
        default_product,
        product_signing,
        product_sdks,
    })
}

fn inspect_product_sdks(profile_content: &str, products: &[String]) -> Vec<HarmonyProductSdk> {
    let product_objects = named_array_body(profile_content, "products")
        .map(array_objects)
        .unwrap_or_default();
    products
        .iter()
        .map(|product| {
            let compile_sdk_version = product_objects
                .iter()
                .find(|object| string_field(object, "name").as_deref() == Some(product))
                .and_then(|object| scalar_field(object, "compileSdkVersion"));
            HarmonyProductSdk {
                product: product.clone(),
                compile_sdk_version,
            }
        })
        .collect()
}

fn inspect_product_signing(
    root: &Path,
    profile_content: &str,
    products: &[String],
) -> Vec<HarmonyProductSigning> {
    let product_objects = named_array_body(profile_content, "products")
        .map(array_objects)
        .unwrap_or_default();
    let signing_objects = named_array_body(profile_content, "signingConfigs")
        .map(array_objects)
        .unwrap_or_default();

    products
        .iter()
        .map(|product| {
            let product_object = product_objects
                .iter()
                .find(|object| string_field(object, "name").as_deref() == Some(product));
            let signing_config =
                product_object.and_then(|object| string_field(object, "signingConfig"));
            let mut issues = Vec::new();
            let signing_object = signing_config.as_ref().and_then(|config_name| {
                signing_objects.iter().find(|object| {
                    string_field(object, "name").as_deref() == Some(config_name.as_str())
                })
            });

            if signing_config.is_none() {
                issues.push("product does not reference signingConfig".to_string());
            } else if signing_object.is_none() {
                issues.push(format!(
                    "signingConfigs does not define '{}'",
                    signing_config.as_deref().unwrap_or_default()
                ));
            }

            if let Some(config) = signing_object {
                if string_field(config, "type").as_deref() != Some("HarmonyOS") {
                    issues.push("signing config type must be HarmonyOS".to_string());
                }
                let material = named_object_body(config, "material");
                for field in ["storePassword", "keyAlias", "keyPassword", "signAlg"] {
                    if material
                        .and_then(|value| string_field(value, field))
                        .is_none()
                    {
                        issues.push(format!("material.{field} is missing"));
                    }
                }
                for field in ["certpath", "profile", "storeFile"] {
                    match material.and_then(|value| string_field(value, field)) {
                        None => issues.push(format!("material.{field} is missing")),
                        Some(value) if !resolve_material_path(root, &value).is_file() => {
                            issues.push(format!("material.{field} file does not exist"));
                        }
                        Some(_) => {}
                    }
                }
            }

            HarmonyProductSigning {
                product: product.clone(),
                signing_config,
                ready: issues.is_empty(),
                issues,
            }
        })
        .collect()
}

fn resolve_material_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn find_harmony_project_root(selected_dir: &Path) -> PathBuf {
    let mut current = selected_dir.to_path_buf();
    let mut best_candidate = None;
    let mut best_priority = 0;
    loop {
        let priority = harmony_project_root_priority(&current);
        if priority == 5 {
            return current;
        }
        if priority > best_priority {
            best_priority = priority;
            best_candidate = Some(current.clone());
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => return best_candidate.unwrap_or_else(|| selected_dir.to_path_buf()),
        }
    }
}

fn harmony_project_root_priority(path: &Path) -> u8 {
    let profile_content = fs::read_to_string(path.join("build-profile.json5")).unwrap_or_default();
    if !declared_project_modules(&profile_content).is_empty() {
        return 5;
    }
    if path.join("hvigorw").is_file() || path.join("hvigorw.bat").is_file() {
        return 4;
    }
    let has_hvigor_file = path.join("hvigorfile.ts").is_file();
    let has_build_profile = path.join("build-profile.json5").is_file();
    if has_hvigor_file && has_build_profile {
        return 3;
    }
    if has_hvigor_file || has_build_profile {
        return 2;
    }
    u8::from(path.join("oh-package.json5").is_file())
}

fn discover_modules(
    root: &Path,
    profile_content: &str,
    declarations: &[ProjectModuleDeclaration],
) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(root).map_err(|error| error.to_string())?;
    let mut modules = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let module_path = entry.path();
            module_path
                .join("src/main")
                .is_dir()
                .then(|| entry.file_name().to_string_lossy().to_string())
        })
        .collect::<Vec<_>>();
    modules.extend(declarations.iter().map(|module| module.name.clone()));
    modules.extend(legacy_declared_modules(root, profile_content));
    modules.sort();
    modules.dedup();
    Ok(modules)
}

fn declared_project_modules(profile_content: &str) -> Vec<ProjectModuleDeclaration> {
    let objects = named_array_body(profile_content, "modules")
        .map(array_objects)
        .unwrap_or_default();
    objects
        .into_iter()
        .filter_map(|object| {
            let name = string_field(object, "name")?;
            let src_path = string_field(object, "srcPath")?;
            (!name.is_empty() && !src_path.is_empty())
                .then_some(ProjectModuleDeclaration { name, src_path })
        })
        .fold(Vec::new(), |mut modules, module| {
            if !modules
                .iter()
                .any(|existing: &ProjectModuleDeclaration| existing.name == module.name)
            {
                modules.push(module);
            }
            modules
        })
}

fn selected_declared_module(
    root: &Path,
    selected_path: &Path,
    declarations: &[ProjectModuleDeclaration],
) -> Option<String> {
    let selected_path =
        fs::canonicalize(selected_path).unwrap_or_else(|_| selected_path.to_path_buf());
    declarations
        .iter()
        .filter_map(|module| {
            let src_path = PathBuf::from(&module.src_path);
            let module_path = if src_path.is_absolute() {
                src_path
            } else {
                root.join(src_path)
            };
            let module_path = fs::canonicalize(&module_path).unwrap_or(module_path);
            selected_path
                .starts_with(&module_path)
                .then_some((module_path.components().count(), module.name.clone()))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, name)| name)
}

fn legacy_declared_modules(root: &Path, profile_content: &str) -> Vec<String> {
    let objects = named_array_body(profile_content, "modules")
        .map(array_objects)
        .unwrap_or_default();
    objects
        .into_iter()
        .filter_map(|object| {
            let name = string_field(object, "name")?;
            (string_field(object, "srcPath").is_none() && root.join(&name).is_dir()).then_some(name)
        })
        .collect()
}

#[cfg(test)]
#[path = "build_project_service_tests.rs"]
mod tests;
