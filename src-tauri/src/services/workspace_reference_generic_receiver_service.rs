use std::collections::HashMap;

pub fn generic_class_fields(content: &str) -> HashMap<String, GenericClass> {
    let mut classes = HashMap::new();
    let mut current: Option<GenericClass> = None;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if let Some(generic_class) = generic_class_start(trimmed) {
            current = Some(generic_class);
            continue;
        }
        if trimmed.starts_with('}') {
            if let Some(generic_class) = current.take() {
                classes.insert(generic_class.name.clone(), generic_class);
            }
            continue;
        }
        if let Some(generic_class) = current.as_mut() {
            if let Some((name, type_name)) = receiver_type_from_field(line) {
                generic_class.fields.push(GenericField {
                    name: name.to_string(),
                    type_name: type_name.to_string(),
                });
            }
        }
    }
    if let Some(generic_class) = current {
        classes.insert(generic_class.name.clone(), generic_class);
    }
    classes
}

pub fn bind_generic_receiver_type(
    receivers: &mut HashMap<String, String>,
    generic_classes: &HashMap<String, GenericClass>,
    receiver: String,
    type_expression: &str,
) {
    if is_identifier(type_expression) {
        receivers.insert(receiver, type_expression.to_string());
        return;
    }
    let Some((class_name, argument_type)) = generic_type_parts(type_expression) else {
        return;
    };
    receivers.insert(receiver.clone(), class_name.to_string());
    let Some(generic_class) = generic_classes.get(class_name) else {
        return;
    };
    for field in &generic_class.fields {
        if field.type_name == generic_class.type_param {
            bind_generic_receiver_type(
                receivers,
                generic_classes,
                format!("{receiver}.{}", field.name),
                argument_type,
            );
        }
    }
}

pub fn generic_type_parts(type_expression: &str) -> Option<(&str, &str)> {
    let generic_start = type_expression.find('<')?;
    let class_name = type_expression.get(..generic_start)?.trim();
    if !is_identifier(class_name) {
        return None;
    }
    let mut depth = 0usize;
    for (index, value) in type_expression.char_indices().skip(generic_start) {
        match value {
            '<' => depth = depth.saturating_add(1),
            '>' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    let argument_type = type_expression.get(generic_start + 1..index)?.trim();
                    if argument_type.is_empty() {
                        return None;
                    }
                    return Some((class_name, argument_type));
                }
            }
            _ => {}
        }
    }
    None
}

fn generic_class_start(line: &str) -> Option<GenericClass> {
    let line = line.strip_prefix("export ").unwrap_or(line);
    let after_class = line.strip_prefix("class ")?;
    let generic_start = after_class.find('<')?;
    let name = after_class.get(..generic_start)?.trim();
    if !is_identifier(name) {
        return None;
    }
    let after_generic_start = after_class.get(generic_start + 1..)?;
    let generic_end = after_generic_start.find('>')?;
    let type_param = after_generic_start.get(..generic_end)?.trim();
    if !is_identifier(type_param) {
        return None;
    }
    Some(GenericClass {
        name: name.to_string(),
        type_param: type_param.to_string(),
        fields: Vec::new(),
    })
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

#[derive(Clone)]
pub struct GenericClass {
    pub name: String,
    pub type_param: String,
    pub fields: Vec<GenericField>,
}

#[derive(Clone)]
pub struct GenericField {
    pub name: String,
    pub type_name: String,
}
