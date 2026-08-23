use serde_json::Value;

use super::{extract_payload, RawSemanticResponse};
use crate::models::diagnostics::{ValidationProblem, ValidationQueryResult};
use crate::models::language::UsageResult;

pub(in crate::services::semantic_host) fn parse_usage_result(item: &Value) -> Option<UsageResult> {
    Some(UsageResult {
        path: item.get("path")?.as_str()?.to_string(),
        line: item.get("line")?.as_u64()? as u32,
        column: item.get("column")?.as_u64()? as u32,
        preview: item.get("preview")?.as_str()?.to_string(),
        kind: item.get("kind")?.as_str()?.to_string(),
        confidence: item.get("confidence")?.as_str()?.to_string(),
        caller: None,
    })
}

pub(super) fn parse_diagnostics_response(
    response: &RawSemanticResponse,
) -> Result<ValidationQueryResult, String> {
    let payload = extract_payload(&response.payload, "diagnostics");
    let items = payload
        .as_array()
        .ok_or_else(|| "Semantic worker diagnostics response was not an array".to_string())?;
    let items = items
        .iter()
        .cloned()
        .map(serde_json::from_value::<ValidationProblem>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to parse semantic worker diagnostic: {error}"))?;

    Ok(
        match response
            .state
            .as_ref()
            .and_then(|state| state.type_status.as_deref())
        {
            Some("ready") => ValidationQueryResult::ready(items),
            Some("partial") => ValidationQueryResult::partial(
                items,
                "Semantic type evidence is partial; diagnostics may be incomplete",
            ),
            _ => ValidationQueryResult::unavailable(
                "Semantic worker could not provide authoritative diagnostic evidence",
            ),
        },
    )
}
