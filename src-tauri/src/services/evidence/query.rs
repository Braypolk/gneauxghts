//! Explicit temporal inputs. The agent interprets the user's timeframe; this
//! module validates dates and resolves timezone boundaries, never user prose.
use crate::services::tool_outcome::ToolError;
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct QueryAnchor {
    pub(crate) instant: DateTime<Utc>,
    pub(crate) timezone: String,
}
impl Default for QueryAnchor {
    fn default() -> Self {
        Self {
            instant: Utc::now(),
            timezone: iana_time_zone::get_timezone().unwrap_or_default(),
        }
    }
}

impl QueryAnchor {
    pub(crate) fn label(&self) -> String {
        let local = self
            .timezone
            .parse::<Tz>()
            .ok()
            .map(|zone| {
                self.instant
                    .with_timezone(&zone)
                    .format("%Y-%m-%d %A %H:%M:%S %:z")
                    .to_string()
            })
            .unwrap_or_else(|| "Local time unavailable".into());
        format!(
            "{}; local {} ({}). Unless the user specifies otherwise, calendar weeks start Monday.",
            self.instant.to_rfc3339(),
            local,
            self.timezone
        )
    }
}

/// Half-open interval: start inclusive, end exclusive. Dates denote local
/// midnight in `timezone`; RFC3339 timestamps carry their own UTC offset.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ActivityRange {
    pub(crate) start: String,
    pub(crate) end: String,
    #[serde(default)]
    pub(crate) timezone: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResolvedPeriod {
    pub(crate) after: u64,
    pub(crate) before: u64,
    pub(crate) timezone: String,
    pub(crate) label: String,
}

impl ActivityRange {
    pub(crate) fn schema() -> Value {
        json!({"type":"object","additionalProperties":false,"required":["start","end"],"properties":{
            "start":{"type":"string","description":"Inclusive YYYY-MM-DD local date or RFC3339 timestamp with UTC offset."},
            "end":{"type":"string","description":"Exclusive YYYY-MM-DD local date or RFC3339 timestamp with UTC offset."},
            "timezone":{"type":"string","description":"IANA timezone for local dates; defaults to the run's supplied timezone."}
        }})
    }
    pub(crate) fn resolve(&self, anchor: &QueryAnchor) -> Result<ResolvedPeriod, ToolError> {
        let timezone = self.timezone.as_deref().unwrap_or(&anchor.timezone);
        let zone: Tz = timezone
            .parse()
            .map_err(|_| ToolError::invalid("Provide a valid IANA timezone"))?;
        let boundary = |value: &str| -> Result<u64, ToolError> {
            let instant = if value.len() == 10 {
                let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
                    ToolError::invalid(
                        "Use YYYY-MM-DD dates or RFC3339 timestamps with UTC offsets",
                    )
                })?;
                zone.from_local_datetime(&date.and_hms_opt(0, 0, 0).ok_or_else(|| ToolError::invalid("Invalid date"))?)
                    .single()
                    .ok_or_else(|| ToolError::invalid("Local midnight is ambiguous or nonexistent; provide an explicit RFC3339 timestamp"))?
                    .with_timezone(&Utc)
            } else {
                DateTime::parse_from_rfc3339(value)
                    .map_err(|_| {
                        ToolError::invalid(
                            "Use YYYY-MM-DD dates or RFC3339 timestamps with UTC offsets",
                        )
                    })?
                    .with_timezone(&Utc)
            };
            u64::try_from(instant.timestamp_millis())
                .map_err(|_| ToolError::invalid("Dates before 1970 are unsupported"))
        };
        let after = boundary(&self.start)?;
        let before = boundary(&self.end)?;
        if after >= before {
            return Err(ToolError::invalid(
                "Activity range must have start before end (end is exclusive)",
            ));
        }
        Ok(ResolvedPeriod {
            after,
            before,
            timezone: timezone.into(),
            label: format!(
                "{} to {} (end exclusive), {}",
                self.start, self.end, timezone
            ),
        })
    }
}

/// Read old and new durable query events without replaying a workflow schema,
/// returned facts, or an event/deadline date as a text-activity filter.
pub(crate) fn previous_context(details: &Value) -> Option<Value> {
    let resolved = &details["resolved"];
    let period = if resolved["after"].is_u64() {
        resolved
    } else {
        let predicates = resolved["intent"]["time"].as_array()?;
        if predicates.len() != 1 || predicates[0]["role"] != "text_activity" {
            return None;
        }
        resolved["periods"].as_array()?.first()?
    };
    let timestamp = |key: &str| {
        DateTime::<Utc>::from_timestamp_millis(i64::try_from(period[key].as_u64()?).ok()?)
            .map(|d| d.to_rfc3339())
    };
    let submitted = &details["submitted"];
    Some(
        json!({"activity_range":{"start":timestamp("after")?,"end":timestamp("before")?,"timezone":period["timezone"]},
        "include_history":submitted["include_history"],
        "query":submitted.get("query").or_else(|| submitted["interpretation"].get("subject")),
        "note_ids":submitted["note_ids"],"folder":submitted["folder"],"cursor":details["continuation"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn anchor() -> QueryAnchor {
        QueryAnchor {
            instant: "2026-09-29T01:00:00Z".parse().unwrap(),
            timezone: "America/Denver".into(),
        }
    }
    fn range(start: &str, end: &str) -> ActivityRange {
        ActivityRange {
            start: start.into(),
            end: end.into(),
            timezone: None,
        }
    }
    #[test]
    fn followups_preserve_explicit_bounds_without_old_workflows_or_result_facts() {
        let period = json!({"after":1_000_000,"before":2_000_000,"timezone":"UTC"});
        let current = previous_context(&json!({"resolved":period,"submitted":{"query":"review"},"notesReturned":999,"continuation":"opaque"})).unwrap();
        assert_eq!(current["cursor"], "opaque");
        assert!(current.get("notesReturned").is_none());
        assert_eq!(
            current["activity_range"]["start"],
            "1970-01-01T00:16:40+00:00"
        );
        let mut old = json!({"resolved":{"periods":[period],"intent":{"time":[{"role":"text_activity"}]}},"submitted":{"interpretation":{"subject":"review"}}});
        let converted = previous_context(&old).unwrap();
        assert_eq!(converted["activity_range"], current["activity_range"]);
        assert_eq!(converted["query"], "review");
        assert!(converted.get("interpretation").is_none());
        old["resolved"]["intent"]["time"][0]["role"] = json!("due");
        assert!(previous_context(&old).is_none());
    }
    #[test]
    fn arbitrary_dates_and_timestamp_offsets_are_half_open() {
        let resolved = range("2026-09-21", "2026-09-28")
            .resolve(&anchor())
            .unwrap();
        assert_eq!(resolved.before - resolved.after, 7 * 86400000);
        assert_eq!(
            resolved.after,
            "2026-09-21T00:00:00-06:00"
                .parse::<DateTime<Utc>>()
                .unwrap()
                .timestamp_millis() as u64
        );
        let exact = range("2026-09-21T13:17:00-06:00", "2026-09-21T20:02:00Z")
            .resolve(&anchor())
            .unwrap();
        assert_eq!(exact.before - exact.after, 45 * 60000);
        let long = range("2025-02-13", "2026-08-19")
            .resolve(&anchor())
            .unwrap();
        assert!(long.before > long.after);
    }
    #[test]
    fn local_date_ranges_respect_dst_and_selected_timezone() {
        for (start, end, hours) in [
            ("2026-03-08", "2026-03-09", 23),
            ("2026-11-01", "2026-11-02", 25),
        ] {
            let resolved = range(start, end).resolve(&anchor()).unwrap();
            assert_eq!(resolved.before - resolved.after, hours * 3600000);
            let mut utc = range(start, end);
            utc.timezone = Some("UTC".into());
            let resolved = utc.resolve(&anchor()).unwrap();
            assert_eq!(resolved.before - resolved.after, 24 * 3600000);
        }
    }
    #[test]
    fn invalid_or_ambiguous_ranges_are_rejected_without_guessing() {
        for (start, end) in [
            ("last week", "today"),
            ("2026-02-30", "2026-03-02"),
            ("2026-09-21", "2026-09-21"),
            ("2026-09-28", "2026-09-21"),
            ("1969-12-01", "1970-01-02"),
            ("2026-09-21T12:00:00", "2026-09-22"),
        ] {
            assert!(range(start, end).resolve(&anchor()).is_err());
        }
        let mut bad = range("2026-09-21", "2026-09-28");
        bad.timezone = Some("Local".into());
        assert!(bad.resolve(&anchor()).is_err());
        let mut skipped = range("2011-12-30", "2011-12-31");
        skipped.timezone = Some("Pacific/Apia".into());
        assert!(skipped.resolve(&anchor()).is_err());
        assert!(serde_json::from_value::<ActivityRange>(
            json!({"start":"2026-09-21","end":"2026-09-28","period":"this_week"})
        )
        .is_err());
    }
}
