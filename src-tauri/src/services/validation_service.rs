use crate::models::diagnostics::ValidationProblem;

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
        });
    }

    problems
}

#[cfg(test)]
mod tests {
    use super::validate_text_document_content;

    #[test]
    fn reports_lint_and_format_warnings() {
        let problems = validate_text_document_content("C:/demo/main.ets", "console.log('x')\n\tlet a = 1;");

        assert_eq!(problems.len(), 3);
        assert_eq!(problems[0].source, "lint");
        assert_eq!(problems[1].source, "format");
        assert_eq!(problems[2].message, "File should end with a newline");
    }
}
