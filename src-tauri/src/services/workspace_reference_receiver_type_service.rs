use std::collections::{HashMap, HashSet};

use crate::services::workspace_reference_generic_receiver_service::{
    bind_generic_receiver_type, generic_class_fields, generic_type_parts, GenericClass,
};

pub fn receiver_type_map(content: &str) -> HashMap<String, String> {
    receiver_type_map_with_generic_classes(content, &HashMap::new())
}

pub fn receiver_type_map_with_generic_classes(
    content: &str,
    imported_generic_classes: &HashMap<String, GenericClass>,
) -> HashMap<String, String> {
    let mut receivers = HashMap::new();
    let return_types = function_return_type_map(content);
    let mut generic_classes = imported_generic_classes.clone();
    generic_classes.extend(generic_class_fields(content));
    for line in content.lines() {
        if let Some((name, class_name)) = receiver_type_from_new_expression(line) {
            receivers.insert(name.to_string(), class_name.to_string());
        }
        if let Some((name, class_name)) = receiver_type_from_call_expression(line, &return_types) {
            receivers.insert(name.to_string(), class_name.to_string());
        }
        if let Some((name, class_name)) = receiver_type_from_typed_variable(line) {
            receivers.insert(name.to_string(), class_name.to_string());
        }
        if let Some((name, class_name, argument_type)) = receiver_type_from_generic_variable(line) {
            if let Some(generic_class) = generic_classes.get(class_name) {
                for field in &generic_class.fields {
                    if field.type_name == generic_class.type_param {
                        bind_generic_receiver_type(
                            &mut receivers,
                            &generic_classes,
                            format!("{name}.{}", field.name),
                            argument_type,
                        );
                    }
                }
            }
        }
        if let Some((name, class_name)) = receiver_type_from_field(line) {
            receivers.insert(format!("this.{name}"), class_name.to_string());
        }
        for (name, class_name) in receiver_types_from_parameters(line) {
            receivers.insert(name.to_string(), class_name.to_string());
        }
    }
    receivers
}

pub fn receiver_type_maps_by_line(
    content: &str,
    imported_generic_classes: &HashMap<String, GenericClass>,
) -> Vec<HashMap<String, String>> {
    let mut receivers = HashMap::new();
    let mut scoped_guards: Vec<(usize, String, String)> = Vec::new();
    let mut branch_frames: Vec<BranchFrame> = Vec::new();
    let return_types = function_return_type_map(content);
    let mut generic_classes = imported_generic_classes.clone();
    generic_classes.extend(generic_class_fields(content));
    let mut depth = 0usize;
    let mut maps = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim_start();
        let leading_else = trimmed.starts_with("} else");
        let leading_close = trimmed.starts_with('}');
        if leading_close {
            if leading_else {
                close_then_branch(depth, &mut receivers, &mut branch_frames);
            } else {
                close_branch_block(depth, &mut receivers, &mut branch_frames);
            }
            depth = depth.saturating_sub(1);
            scoped_guards.retain(|(guard_depth, _, _)| *guard_depth <= depth);
        }

        let starts_if_block = is_if_block_start(trimmed);
        let branch_entry = receivers.clone();
        collect_receiver_facts(line, &return_types, &generic_classes, &mut receivers);
        let mut current = receivers.clone();
        for (_, name, class_name) in &scoped_guards {
            current.insert(name.clone(), class_name.clone());
        }
        maps.push(current);

        let opens = line.chars().filter(|value| *value == '{').count();
        let closes = line.chars().filter(|value| *value == '}').count();
        depth = depth.saturating_add(opens);
        depth = depth.saturating_sub(closes.saturating_sub(usize::from(leading_close)));
        if let Some((name, class_name)) = receiver_type_from_instanceof_guard(line) {
            scoped_guards.push((depth, name.to_string(), class_name.to_string()));
        }
        if starts_if_block {
            branch_frames.push(BranchFrame {
                block_depth: depth,
                entry: branch_entry,
                then_result: None,
            });
        }
        scoped_guards.retain(|(guard_depth, _, _)| *guard_depth <= depth);
    }
    maps
}

fn close_then_branch(
    depth: usize,
    receivers: &mut HashMap<String, String>,
    branch_frames: &mut [BranchFrame],
) {
    let Some(frame) = branch_frames
        .iter_mut()
        .rev()
        .find(|frame| frame.block_depth == depth && frame.then_result.is_none())
    else {
        return;
    };
    frame.then_result = Some(receivers.clone());
    *receivers = frame.entry.clone();
}

fn close_branch_block(
    depth: usize,
    receivers: &mut HashMap<String, String>,
    branch_frames: &mut Vec<BranchFrame>,
) {
    let Some(index) = branch_frames
        .iter()
        .rposition(|frame| frame.block_depth == depth)
    else {
        return;
    };
    let frame = branch_frames.remove(index);
    let Some(then_result) = frame.then_result else {
        *receivers = frame.entry;
        return;
    };
    let else_result = receivers.clone();
    *receivers = join_branch_receivers(&frame.entry, &then_result, &else_result);
}

fn join_branch_receivers(
    entry: &HashMap<String, String>,
    then_result: &HashMap<String, String>,
    else_result: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut joined = entry.clone();
    let keys = then_result
        .keys()
        .chain(else_result.keys())
        .cloned()
        .collect::<HashSet<_>>();
    for key in keys {
        match (then_result.get(&key), else_result.get(&key)) {
            (Some(then_type), Some(else_type)) if then_type == else_type => {
                joined.insert(key, then_type.clone());
            }
            (then_type, else_type)
                if then_type == entry.get(&key) && else_type == entry.get(&key) => {}
            _ => {
                joined.remove(&key);
            }
        }
    }
    joined
}

fn collect_receiver_facts(
    line: &str,
    return_types: &HashMap<String, String>,
    generic_classes: &HashMap<String, GenericClass>,
    receivers: &mut HashMap<String, String>,
) {
    if let Some((name, class_name)) = receiver_type_from_new_expression(line) {
        receivers.insert(name.to_string(), class_name.to_string());
    }
    if let Some((name, class_name)) = receiver_type_from_new_assignment(line) {
        receivers.insert(name.to_string(), class_name.to_string());
    }
    if let Some((name, class_name)) = receiver_type_from_call_expression(line, return_types) {
        receivers.insert(name.to_string(), class_name.to_string());
    }
    if let Some((name, class_name)) = receiver_type_from_typed_variable(line) {
        receivers.insert(name.to_string(), class_name.to_string());
    }
    if let Some((name, class_name, argument_type)) = receiver_type_from_generic_variable(line) {
        if let Some(generic_class) = generic_classes.get(class_name) {
            for field in &generic_class.fields {
                if field.type_name == generic_class.type_param {
                    bind_generic_receiver_type(
                        receivers,
                        generic_classes,
                        format!("{name}.{}", field.name),
                        argument_type,
                    );
                }
            }
        }
    }
    if let Some((name, class_name)) = receiver_type_from_field(line) {
        receivers.insert(format!("this.{name}"), class_name.to_string());
    }
    for (name, class_name) in receiver_types_from_parameters(line) {
        receivers.insert(name.to_string(), class_name.to_string());
    }
}

fn function_return_type_map(content: &str) -> HashMap<String, String> {
    let mut return_types = HashMap::new();
    for line in content.lines() {
        let Some((name, type_name)) = function_return_type(line) else {
            continue;
        };
        return_types.insert(name.to_string(), type_name.to_string());
    }
    return_types
}

fn function_return_type(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim_start();
    let after_function = trimmed
        .strip_prefix("async function ")
        .or_else(|| trimmed.strip_prefix("function "))?;
    let name_end = after_function.find('(')?;
    let name = after_function.get(..name_end)?.trim();
    if !is_identifier(name) {
        return None;
    }
    let after_name = after_function.get(name_end..)?;
    let return_marker = after_name.find("):")?;
    let return_type = normalize_return_type(after_name.get(return_marker + 2..)?.trim_start())?;
    Some((name, return_type))
}

fn normalize_return_type(return_type: &str) -> Option<&str> {
    if let Some(inner) = return_type.strip_prefix("Promise<") {
        let end = inner.find('>')?;
        let type_name = inner.get(..end)?.trim();
        if is_identifier(type_name) {
            return Some(type_name);
        }
        return None;
    }
    let type_end = return_type
        .find(|value: char| !value.is_ascii_alphanumeric() && value != '_' && value != '$')
        .unwrap_or(return_type.len());
    let type_name = return_type.get(..type_end)?;
    if !is_identifier(type_name) {
        return None;
    }
    Some(type_name)
}

fn receiver_type_from_new_expression(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim_start();
    let after_keyword = trimmed
        .strip_prefix("const ")
        .or_else(|| trimmed.strip_prefix("let "))?;
    let (name, expression) = after_keyword.split_once('=')?;
    let variable = name.trim();
    if !is_identifier(variable) {
        return None;
    }
    let expression = expression.trim_start();
    let after_new = expression.strip_prefix("new ")?;
    let class_end = after_new
        .find(|value: char| !value.is_ascii_alphanumeric() && value != '_' && value != '$')
        .unwrap_or(after_new.len());
    let class_name = after_new.get(..class_end)?;
    if class_name.is_empty() {
        return None;
    }
    Some((variable, class_name))
}

fn receiver_type_from_new_assignment(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim_start();
    let (name, expression) = trimmed.split_once('=')?;
    let variable = name.trim();
    if !is_identifier(variable) {
        return None;
    }
    let expression = expression.trim_start();
    let after_new = expression.strip_prefix("new ")?;
    let class_end = after_new
        .find(|value: char| !value.is_ascii_alphanumeric() && value != '_' && value != '$')
        .unwrap_or(after_new.len());
    let class_name = after_new.get(..class_end)?;
    if class_name.is_empty() {
        return None;
    }
    Some((variable, class_name))
}

fn receiver_type_from_call_expression<'a>(
    line: &'a str,
    return_types: &'a HashMap<String, String>,
) -> Option<(&'a str, &'a str)> {
    let trimmed = line.trim_start();
    let after_keyword = trimmed
        .strip_prefix("const ")
        .or_else(|| trimmed.strip_prefix("let "))?;
    let (name, expression) = after_keyword.split_once('=')?;
    let variable = name.trim();
    if !is_identifier(variable) {
        return None;
    }
    let callee = call_expression_name(expression.trim_start())?;
    return_types
        .get(callee)
        .map(|type_name| (variable, type_name.as_str()))
}

fn receiver_type_from_typed_variable(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim_start();
    let after_keyword = trimmed
        .strip_prefix("const ")
        .or_else(|| trimmed.strip_prefix("let "))?;
    let (name, type_expression) = after_keyword.split_once(':')?;
    let variable = name.trim();
    if !is_identifier(variable) {
        return None;
    }
    let type_expression = type_expression.trim_start();
    if type_expression.contains('<') {
        return None;
    }
    let type_name = normalize_return_type(type_expression)?;
    Some((variable, type_name))
}

fn receiver_type_from_instanceof_guard(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim_start();
    let if_start = trimmed.find("if (")?;
    let after_if = trimmed.get(if_start + 4..)?;
    let guard_end = after_if.find(')')?;
    let guard = after_if.get(..guard_end)?;
    let (name, class_name) = guard.split_once(" instanceof ")?;
    let receiver = name.trim();
    let type_name = class_name.trim();
    if !is_identifier(receiver) || !is_identifier(type_name) {
        return None;
    }
    Some((receiver, type_name))
}

fn is_if_block_start(line: &str) -> bool {
    line.starts_with("if (") && line.contains('{')
}

fn receiver_type_from_generic_variable(line: &str) -> Option<(&str, &str, &str)> {
    let trimmed = line.trim_start();
    let after_keyword = trimmed
        .strip_prefix("const ")
        .or_else(|| trimmed.strip_prefix("let "))?;
    let (name, type_expression) = after_keyword.split_once(':')?;
    let variable = name.trim();
    if !is_identifier(variable) {
        return None;
    }
    let (class_name, argument_type) = generic_type_parts(type_expression.trim_start())?;
    Some((variable, class_name, argument_type))
}

fn call_expression_name(expression: &str) -> Option<&str> {
    let expression = expression.strip_prefix("await ").unwrap_or(expression);
    let end = expression.find('(')?;
    let name = expression.get(..end)?.trim();
    if !is_identifier(name) {
        return None;
    }
    Some(name)
}

fn receiver_type_from_field(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim_start();
    let candidate = strip_member_modifiers(trimmed);
    let (name, rest) = candidate.split_once(':')?;
    let field_name = name.trim();
    if !is_identifier(field_name) {
        return None;
    }
    let type_name = rest
        .trim_start()
        .split(|value: char| !value.is_ascii_alphanumeric() && value != '_' && value != '$')
        .next()?;
    if !is_identifier(type_name) {
        return None;
    }
    Some((field_name, type_name))
}

fn strip_member_modifiers(mut value: &str) -> &str {
    loop {
        let trimmed = value.trim_start();
        let Some((first, rest)) = trimmed.split_once(char::is_whitespace) else {
            return trimmed;
        };
        if !matches!(
            first,
            "public" | "private" | "protected" | "readonly" | "static" | "declare"
        ) {
            return trimmed;
        }
        value = rest;
    }
}

fn receiver_types_from_parameters(line: &str) -> Vec<(&str, &str)> {
    let Some(start) = line.find('(') else {
        return Vec::new();
    };
    let Some(end_offset) = line[start + 1..].find(')') else {
        return Vec::new();
    };
    let parameters = &line[start + 1..start + 1 + end_offset];
    parameters
        .split(',')
        .filter_map(parameter_receiver_type)
        .collect()
}

fn parameter_receiver_type(value: &str) -> Option<(&str, &str)> {
    let (name, type_name) = value.split_once(':')?;
    let name = name.trim();
    let type_name = type_name.trim();
    if !is_identifier(name) || !is_identifier(type_name) {
        return None;
    }
    Some((name, type_name))
}

fn is_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    is_identifier_start(first) && bytes.all(is_identifier_part)
}

fn is_identifier_start(value: u8) -> bool {
    value.is_ascii_alphabetic() || value == b'_' || value == b'$'
}

fn is_identifier_part(value: u8) -> bool {
    value.is_ascii_alphanumeric() || value == b'_' || value == b'$'
}

struct BranchFrame {
    block_depth: usize,
    entry: HashMap<String, String>,
    then_result: Option<HashMap<String, String>>,
}
