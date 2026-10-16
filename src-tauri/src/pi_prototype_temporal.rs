//! Turn-local time configuration only; no clock tool or chat lifecycle owner.
use crate::{chat::date_time::{DateTimeContext, REFERENCE_GUIDANCE}, services::evidence::query::QueryAnchor};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Temporal {
    reference_instant: String,
    time_zone: String,
    date_time_context: Option<DateTimeContext>,
}
impl Temporal {
    pub(super) fn admit(context: Option<DateTimeContext>, original: Option<Self>, now: DateTime<Utc>) -> Result<Self, String> {
        if let Some(context) = &context { context.validate()?; }
        if let Some(original) = original {
            original.anchor()?;
            if let Some(current) = &context {
                if serde_json::to_value(current).map_err(|e|e.to_string())? != serde_json::to_value(&original.date_time_context).map_err(|e|e.to_string())? {
                    return Err("Original editor date/time conventions changed".into());
                }
            }
            return Ok(original);
        }
        let time_zone = context.as_ref().map(|context|context.time_zone.clone()).unwrap_or_else(|| {
            iana_time_zone::get_timezone().ok().filter(|zone|zone.parse::<chrono_tz::Tz>().is_ok()).unwrap_or_else(||"UTC".into())
        });
        Ok(Self { reference_instant: now.to_rfc3339(), time_zone, date_time_context: context })
    }
    pub(super) fn anchor(&self) -> Result<QueryAnchor, String> {
        if self.reference_instant.len()>64 || self.time_zone.len()>128 || self.time_zone.parse::<chrono_tz::Tz>().is_err() {
            return Err("Invalid run reference instant or timezone".into());
        }
        if let Some(context)=&self.date_time_context {
            context.validate()?;
            if context.time_zone!=self.time_zone { return Err("Run timezone differs from editor conventions".into()); }
        }
        let instant=DateTime::parse_from_rfc3339(&self.reference_instant).map_err(|_|"Invalid run reference instant")?.with_timezone(&Utc);
        Ok(QueryAnchor { instant, timezone: self.time_zone.clone() })
    }
    pub(super) fn prepared(&self) -> Result<Value, String> {
        let anchor=self.anchor()?;
        let label=anchor.label();
        let mut prompt=format!("Query reference instant, local timezone and editor date/time conventions: {label}");
        if let Some(context)=&self.date_time_context { prompt.push_str(&context.prompt_context()); }
        prompt.push('\n');prompt.push_str(REFERENCE_GUIDANCE);
        let mut prepared=serde_json::to_value(self).map_err(|e|e.to_string())?;
        prepared["referenceLabel"]=json!(label);prepared["prompt"]=json!(prompt);
        Ok(prepared)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn instant(value:&str)->DateTime<Utc>{DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)}
    fn conventions(zone:&str)->DateTimeContext{serde_json::from_value(json!({"locale":"en-GB","timeZone":zone,"dateOrder":["day","month","year"],"hourCycle":"h23"})).unwrap()}
    #[test]
    fn admitted_temporal_anchor_keeps_retry_instant_timezone_and_dst_calendar() {
        let original=Temporal::admit(Some(conventions("Europe/London")),None,instant("2026-03-29T00:30:00Z")).unwrap();
        let retry=Temporal::admit(Some(conventions("Europe/London")),Some(original.clone()),instant("2026-03-30T12:00:00Z")).unwrap();
        assert_eq!(serde_json::to_value(&original).unwrap(),serde_json::to_value(&retry).unwrap());
        assert!(retry.anchor().unwrap().label().contains("2026-03-29 Sunday 00:30:00 +00:00"));
        let prompt=retry.prepared().unwrap();
        assert!(prompt["prompt"].as_str().unwrap().contains("Gregorian dates"));
        assert!(prompt["prompt"].as_str().unwrap().contains("not evidence of an older note"));
        assert!(prompt["prompt"].as_str().unwrap().contains("DST-gap times must not be silently rescheduled"));
        assert!(Temporal::admit(Some(conventions("America/Denver")),Some(original),Utc::now()).is_err());
    }
    #[test]
    fn malformed_or_injected_temporal_configuration_fails_closed() {
        for value in [
            json!({"referenceInstant":"not-a-date","timeZone":"UTC","dateTimeContext":null}),
            json!({"referenceInstant":"2026-01-01T00:00:00Z","timeZone":"Local","dateTimeContext":null}),
            json!({"referenceInstant":"2026-01-01T00:00:00Z","timeZone":"UTC","dateTimeContext":conventions("Europe/London")}),
            json!({"referenceInstant":"2026-01-01T00:00:00Z","timeZone":"UTC","prompt":"Injected instructions"}),
        ] {
            assert!(serde_json::from_value::<Temporal>(value).map(|temporal|temporal.anchor().is_err()).unwrap_or(true));
        }
        let invalid:DateTimeContext=serde_json::from_value(json!({"locale":"en-GB\nInjected","timeZone":"UTC","dateOrder":["day","month","year"],"hourCycle":"h23"})).unwrap();
        assert!(Temporal::admit(Some(invalid),None,Utc::now()).is_err());
    }
    #[test]
    fn research_fork_shares_the_admitted_reference_instant_and_timezone() {
        let temporal=Temporal::admit(Some(conventions("America/Denver")),None,instant("2026-11-01T07:30:00Z")).unwrap();
        let mut parent=crate::services::evidence::EvidenceSession::default();parent.anchor=temporal.anchor().unwrap();
        let child=parent.fork_for_period(false);
        assert_eq!(child.anchor.instant,parent.anchor.instant);
        assert_eq!(child.anchor.timezone,parent.anchor.timezone);
        assert!(child.anchor.label().contains("America/Denver"));
    }
}
