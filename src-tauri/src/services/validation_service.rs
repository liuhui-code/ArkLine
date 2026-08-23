use crate::models::diagnostics::{ValidationFix, ValidationProblem, ValidationQueryResult};
use crate::models::semantic_availability::SemanticAvailability;

pub fn validate_text_document_content(path: &str, content: &str) -> Vec<ValidationProblem> {
    let mut problems = Vec::new();

    for (index, line) in content.split('\n').enumerate() {
        if let Some(column) = line.find('\t') {
            problems.push(ValidationProblem {
                source: "format".to_string(),
                severity: "warning".to_string(),
                path: path.to_string(),
                line: index + 1,
                column: column + 1,
                message: "Replace tabs with spaces".to_string(),
                fix: Some(ValidationFix {
                    title: "Replace tab with spaces".to_string(),
                    start_line: index + 1,
                    start_column: column + 1,
                    end_line: index + 1,
                    end_column: column + 2,
                    replacement: "  ".to_string(),
                }),
            });
        }

        if let Some(column) = line.find("console.log(") {
            problems.push(ValidationProblem {
                source: "lint".to_string(),
                severity: "warning".to_string(),
                path: path.to_string(),
                line: index + 1,
                column: column + 1,
                message: "Remove console.log before committing".to_string(),
                fix: None,
            });
        }
    }

    if !content.ends_with('\n') && !content.is_empty() {
        let line_count = content.lines().count().max(1);
        let last_line = content.lines().last().unwrap_or("");
        problems.push(ValidationProblem {
            source: "format".to_string(),
            severity: "warning".to_string(),
            path: path.to_string(),
            line: line_count,
            column: last_line.len().max(1),
            message: "File should end with a newline".to_string(),
            fix: None,
        });
    }

    problems
}

pub fn merge_validation_results(
    mut local: Vec<ValidationProblem>,
    semantic: ValidationQueryResult,
) -> ValidationQueryResult {
    let ValidationQueryResult {
        availability,
        items,
        message,
    } = semantic;
    local.extend(items);

    match availability {
        SemanticAvailability::Ready => ValidationQueryResult::ready(local),
        SemanticAvailability::Partial | SemanticAvailability::Unavailable => {
            ValidationQueryResult::partial(
                local,
                message.unwrap_or_else(|| "Semantic diagnostics are incomplete".to_string()),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{merge_validation_results, validate_text_document_content};
    use crate::models::diagnostics::ValidationQueryResult;

    #[test]
    fn reports_lint_and_format_warnings() {
        let problems =
            validate_text_document_content("C:/demo/main.ets", "console.log('x')\n\tlet a = 1;");

        assert_eq!(problems.len(), 3);
        assert_eq!(problems[0].source, "lint");
        assert_eq!(problems[1].source, "format");
        let fix = problems[1]
            .fix
            .as_ref()
            .expect("tab warning should be safely fixable");
        assert_eq!(fix.title, "Replace tab with spaces");
        assert_eq!((fix.start_line, fix.start_column), (2, 1));
        assert_eq!((fix.end_line, fix.end_column), (2, 2));
        assert_eq!(fix.replacement, "  ");
        assert_eq!(problems[2].message, "File should end with a newline");
        assert!(problems[0].fix.is_none());
        assert!(problems[2].fix.is_none());
    }

    #[test]
    fn keeps_local_diagnostics_partial_when_semantic_evidence_is_unavailable() {
        let local = validate_text_document_content("C:/demo/main.ts", "console.log('x')\n");

        let result = merge_validation_results(
            local,
            ValidationQueryResult::unavailable("Semantic worker is restarting"),
        );
        let value = serde_json::to_value(result).unwrap();

        assert_eq!(value["availability"], "partial");
        assert_eq!(value["items"].as_array().unwrap().len(), 1);
        assert_eq!(
            value["items"][0]["message"],
            "Remove console.log before committing"
        );
        assert_eq!(value["message"], "Semantic worker is restarting");
    }
}
