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
