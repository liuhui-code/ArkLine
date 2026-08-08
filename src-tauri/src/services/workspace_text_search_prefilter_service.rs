#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceTextSearchPrefilterPlan {
    pub literal_hint: Option<String>,
    pub case_insensitive: bool,
}

pub(crate) fn plan_regex_prefilter(source: &str, flags: &str) -> WorkspaceTextSearchPrefilterPlan {
    WorkspaceTextSearchPrefilterPlan {
        literal_hint: regex_literal_hint(source),
        case_insensitive: flags.contains('i'),
    }
}

pub(crate) fn plan_query_regex_prefilter(query: &str) -> Option<WorkspaceTextSearchPrefilterPlan> {
    let trimmed = query.trim();
    if !trimmed.starts_with('/') {
        return None;
    }
    let slash_index = trimmed.rfind('/')?;
    if slash_index == 0 {
        return None;
    }
    Some(plan_regex_prefilter(
        &trimmed[1..slash_index],
        &trimmed[slash_index + 1..],
    ))
}

pub(crate) fn content_matches_prefilter(
    content: &str,
    plan: &WorkspaceTextSearchPrefilterPlan,
) -> bool {
    let Some(hint) = &plan.literal_hint else {
        return true;
    };
    if plan.case_insensitive {
        return content.to_lowercase().contains(&hint.to_lowercase());
    }
    content.contains(hint)
}

fn regex_literal_hint(source: &str) -> Option<String> {
    if contains_non_required_literal_construct(source) {
        return None;
    }
    let mut best = String::new();
    let mut current = String::new();
    let mut escaped = false;
    for character in source.chars() {
        if escaped {
            if regex_escape_is_literal(character) {
                current.push(character);
            } else {
                keep_longest_literal(&mut best, &mut current);
            }
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if regex_character_is_literal(character) {
            current.push(character);
        } else {
            keep_longest_literal(&mut best, &mut current);
        }
    }
    keep_longest_literal(&mut best, &mut current);
    if best.chars().count() >= 3 {
        Some(best)
    } else {
        None
    }
}

fn contains_non_required_literal_construct(source: &str) -> bool {
    let mut escaped = false;
    let mut in_character_class = false;
    for character in source.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '[' if !in_character_class => in_character_class = true,
            ']' if in_character_class => in_character_class = false,
            '|' | '?' | '*' | '{' if !in_character_class => return true,
            _ => {}
        }
    }
    false
}

fn keep_longest_literal(best: &mut String, current: &mut String) {
    if current.chars().count() > best.chars().count() {
        *best = current.clone();
    }
    current.clear();
}

fn regex_escape_is_literal(character: char) -> bool {
    matches!(
        character,
        '\\' | '/' | '.' | '+' | '*' | '?' | '^' | '$' | '(' | ')' | '[' | ']' | '{' | '}' | '|'
    )
}

fn regex_character_is_literal(character: char) -> bool {
    !matches!(
        character,
        '.' | '+' | '*' | '?' | '^' | '$' | '(' | ')' | '[' | ']' | '{' | '}' | '|'
    )
}
