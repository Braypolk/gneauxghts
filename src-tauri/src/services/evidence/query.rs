//! Query meaning and calendar calculation. No note/history or runtime ownership.
use chrono::{DateTime, Datelike, Days, Months, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct QueryAnchor {
    pub(crate) instant: DateTime<Utc>,
    pub(crate) timezone: String,
    pub(crate) previous: Vec<(DateRole, ResolvedPeriod)>,
}
impl Default for QueryAnchor {
    fn default() -> Self {
        Self {
            instant: Utc::now(),
            timezone: iana_time_zone::get_timezone().unwrap_or_default(),
            previous: Vec::new(),
        }
    }
}

/// A deliberately small guard for one unambiguous relative calendar phrase in
/// the user's request. It never parses note content or replaces interpretation.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct RequestedCalendar {
    pub(crate) unit: CalendarUnit,
    pub(crate) offset: i32,
}
impl RequestedCalendar {
    pub(crate) fn from_question(question: &str) -> Option<Self> {
        if question
            .chars()
            .any(|c| c.is_ascii_digit() || matches!(c, '"' | '`'))
        {
            return None;
        }
        let words: Vec<_> = question
            .split(|c: char| !c.is_alphabetic())
            .filter(|s| !s.is_empty())
            .map(str::to_lowercase)
            .collect();
        if words.iter().any(|s| {
            matches!(
                s.as_str(),
                "not"
                    | "except"
                    | "before"
                    | "after"
                    | "until"
                    | "since"
                    | "year"
                    | "years"
                    | "ago"
                    | "monday"
                    | "tuesday"
                    | "wednesday"
                    | "thursday"
                    | "friday"
                    | "saturday"
                    | "sunday"
                    | "weekend"
                    | "january"
                    | "february"
                    | "march"
                    | "april"
                    | "may"
                    | "june"
                    | "july"
                    | "august"
                    | "september"
                    | "october"
                    | "november"
                    | "december"
                    | "half"
                    | "early"
                    | "late"
                    | "first"
                    | "second"
                    | "between"
            )
        }) {
            return None;
        }
        let mut found = Vec::new();
        for (i, word) in words.iter().enumerate() {
            // Require a plain connector/activity immediately before the phrase.
            // Expressions such as "three days ending yesterday" are not a day
            // query merely because their last word names a day.
            let plain_prefix = i == 0
                || matches!(
                    words[i - 1].as_str(),
                    "edit"
                        | "changes"
                        | "edited"
                        | "change"
                        | "changed"
                        | "created"
                        | "updated"
                        | "modified"
                        | "activity"
                        | "on"
                        | "during"
                        | "in"
                        | "due"
                        | "scheduled"
                        | "happened"
                        | "occurred"
                        | "meetings"
                        | "events"
                        | "tasks"
                        | "notes"
                );
            let duration_prefix = words[..i].iter().any(|s| {
                matches!(
                    s.as_str(),
                    "day"
                        | "days"
                        | "week"
                        | "weeks"
                        | "month"
                        | "months"
                        | "hour"
                        | "hours"
                        | "minute"
                        | "minutes"
                        | "quarter"
                        | "quarters"
                )
            });
            let plain_suffix = |end: usize| {
                matches!(
                    words[end..]
                        .iter()
                        .map(String::as_str)
                        .collect::<Vec<_>>()
                        .as_slice(),
                    [] | ["please"] | ["list", "them"]
                )
            };
            let single = match word.as_str() {
                "today" => Some(0),
                "yesterday" => Some(-1),
                "tomorrow" => Some(1),
                _ => None,
            };
            if let Some(offset) = single {
                if !plain_prefix || duration_prefix || !plain_suffix(i + 1) {
                    return None;
                }
                found.push(Self {
                    unit: CalendarUnit::Day,
                    offset,
                });
            }
            let offset = match word.as_str() {
                "this" => Some(0),
                "last" => Some(-1),
                "next" => Some(1),
                _ => None,
            };
            let unit = match words.get(i + 1).map(String::as_str) {
                Some("week") => Some(CalendarUnit::Week),
                Some("month") => Some(CalendarUnit::Month),
                _ => None,
            };
            if let (Some(offset), Some(unit)) = (offset, unit) {
                if !plain_prefix || duration_prefix || !plain_suffix(i + 2) {
                    return None;
                }
                found.push(Self { unit, offset });
            }
        }
        (found.len() == 1).then(|| found.remove(0))
    }
    pub(crate) fn validate(&self, intent: Option<&QueryIntent>) -> Result<(), String> {
        if intent.is_some_and(|i| i.time.len() == 1 && matches!(i.time[0].period, Period::Calendar {unit,offset,..} if unit == self.unit && offset == self.offset)) {
            Ok(())
        } else {
            Err(format!("The user supplied one relative calendar period. Use interpretation.time with period {{kind: calendar, unit: {:?}, offset: {}}}; do not calculate explicit dates or epoch bounds.", self.unit, self.offset))
        }
    }
}

pub(crate) fn instructions() -> &'static str {
    "For a plain list/count of notes edited in a date range, use search_evidence.interpretation with target notes, operation list/count, subject null unless a real topic was requested, no conditions, and one text_activity period. Use calendar periods: last week is {kind:calendar,unit:week,offset:-1}, this week offset 0; never compute dates for relative phrases. The app completes this inventory directly; call it alone. Other questions use ordinary query search and read_evidence. Do not confuse event dates or deadlines with file edits. Never repeat identical read arguments when retryable=false. Follow-up inventories use period previous with the same date role: offset -1 for the week before, offset 0 and the supplied cursor to continue. Retrieve fresh evidence."
}

macro_rules! vocabulary {
    ($name:ident { $($variant:ident),+ }) => {
        #[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
        #[serde(rename_all = "snake_case")]
        pub(crate) enum $name { $($variant),+ }
    };
}
vocabulary!(Target { Notes });
vocabulary!(Operation { List, Count });
// Historical query events may contain these roles. Keep their date identity when
// reading old conversations; new structured requests only allow TextActivity.
vocabulary!(DateRole {
    TextActivity,
    StatusChanged,
    Occurred,
    Scheduled,
    Due,
    Effective
});
vocabulary!(Relation {
    Within,
    Before,
    After,
    Overlap
});
vocabulary!(CalendarUnit { Day, Week, Month });
vocabulary!(DurationUnit { Hours, Days });

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Period {
    Calendar {
        unit: CalendarUnit,
        offset: i32,
        #[serde(default)]
        full: bool,
    },
    Dates {
        start: String,
        end: String,
    },
    Rolling {
        amount: u32,
        unit: DurationUnit,
    },
    Previous {
        unit: CalendarUnit,
        offset: i32,
    },
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TemporalPredicate {
    pub(crate) role: DateRole,
    pub(crate) relation: Relation,
    pub(crate) period: Period,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct QueryIntent {
    pub(crate) target: Target,
    pub(crate) operation: Operation,
    #[serde(default)]
    pub(crate) subject: Option<String>,
    #[serde(default)]
    pub(crate) conditions: Vec<Value>,
    #[serde(default)]
    pub(crate) time: Vec<TemporalPredicate>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ResolvedPeriod {
    pub(crate) after: u64,
    pub(crate) before: u64,
    pub(crate) timezone: String,
    pub(crate) label: String,
}
#[derive(Clone, Debug, Serialize)]
pub(crate) struct ResolvedQuery {
    pub(crate) intent: QueryIntent,
    pub(crate) periods: Vec<ResolvedPeriod>,
    pub(crate) workflow: &'static str,
}

impl QueryAnchor {
    pub(crate) fn resolve(
        &self,
        period: &Period,
        role: DateRole,
    ) -> Result<ResolvedPeriod, String> {
        if let Period::Previous { unit, offset } = period {
            let matches: Vec<_> = self
                .previous
                .iter()
                .filter(|(prior_role, _)| *prior_role == role)
                .collect();
            if matches.len() != 1 {
                return Err(
                    "No unique prior period with this date meaning is available; specify dates"
                        .into(),
                );
            }
            let previous = &matches[0].1;
            if *offset == 0 {
                return Ok(previous.clone());
            }
            let anchor = QueryAnchor {
                instant: DateTime::from_timestamp_millis(previous.after as i64)
                    .ok_or("Prior date unavailable")?,
                timezone: previous.timezone.clone(),
                previous: Vec::new(),
            };
            return anchor.resolve(
                &Period::Calendar {
                    unit: *unit,
                    offset: *offset,
                    full: true,
                },
                role,
            );
        }
        let zone: Tz = self
            .timezone
            .parse()
            .map_err(|_| "Query timezone is unavailable; configure a named system timezone")?;
        let now = self.instant.with_timezone(&zone);
        let today = now.date_naive();
        let midnight = |date: NaiveDate| -> Result<DateTime<Tz>, String> {
            zone.from_local_datetime(&date.and_hms_opt(0, 0, 0).ok_or("Invalid calendar date")?)
                .single()
                .ok_or_else(|| {
                    "Calendar boundary is ambiguous or nonexistent in the query timezone".into()
                })
        };
        let date = |s: &str| {
            NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|_| "Use explicit ISO dates with a year (YYYY-MM-DD)".to_string())
        };
        let (start, end) = match period {
            Period::Previous { .. } => unreachable!("handled above"),
            Period::Dates { start, end } => {
                let start = date(start)?;
                let end = date(end)?.succ_opt().ok_or("Date range overflows")?;
                (midnight(start)?, midnight(end)?)
            }
            Period::Rolling { amount, unit } => {
                if *amount == 0 || *amount > 3660 {
                    return Err("Rolling amount must be 1–3660".into());
                }
                let hours = i64::from(*amount) * if *unit == DurationUnit::Days { 24 } else { 1 };
                (
                    now.checked_sub_signed(chrono::Duration::hours(hours))
                        .ok_or("Duration overflows")?,
                    now,
                )
            }
            Period::Calendar { unit, offset, full } => {
                if !(-120..=120).contains(offset) {
                    return Err("Calendar offset must be between -120 and 120".into());
                }
                let shift_days = |d: NaiveDate, n: i64| {
                    if n >= 0 {
                        d.checked_add_days(Days::new(n as u64))
                    } else {
                        d.checked_sub_days(Days::new((-n) as u64))
                    }
                    .ok_or("Calendar range overflows")
                };
                let (start, end) = match unit {
                    CalendarUnit::Day => {
                        let d = shift_days(today, i64::from(*offset))?;
                        (d, shift_days(d, 1)?)
                    }
                    CalendarUnit::Week => {
                        let monday =
                            shift_days(today, -i64::from(today.weekday().num_days_from_monday()))?;
                        let d = shift_days(monday, i64::from(*offset) * 7)?;
                        (d, shift_days(d, 7)?)
                    }
                    CalendarUnit::Month => {
                        let first = today.with_day(1).ok_or("Invalid month")?;
                        let d = if *offset >= 0 {
                            first.checked_add_months(Months::new(*offset as u32))
                        } else {
                            first.checked_sub_months(Months::new(offset.unsigned_abs()))
                        }
                        .ok_or("Month range overflows")?;
                        (
                            d,
                            d.checked_add_months(Months::new(1))
                                .ok_or("Month range overflows")?,
                        )
                    }
                };
                let retrospective =
                    matches!(role, DateRole::TextActivity | DateRole::StatusChanged);
                (
                    midnight(start)?,
                    if *offset == 0 && !full && retrospective {
                        now
                    } else {
                        midnight(end)?
                    },
                )
            }
        };
        let after = u64::try_from(start.timestamp_millis())
            .map_err(|_| "Dates before 1970 are unsupported")?;
        let before = u64::try_from(end.timestamp_millis())
            .map_err(|_| "Dates before 1970 are unsupported")?;
        if after >= before {
            return Err("The query period must be nonempty".into());
        }
        Ok(ResolvedPeriod {
            after,
            before,
            timezone: self.timezone.clone(),
            label: format!(
                "{} through {} (end exclusive), {}",
                start.format("%b %-d, %Y %H:%M"),
                end.format("%b %-d, %Y %H:%M"),
                self.timezone
            ),
        })
    }
    pub(crate) fn normalize(&self, intent: &QueryIntent) -> Result<ResolvedQuery, String> {
        if intent.subject.as_ref().is_some_and(|s| s.len() > 1024) {
            return Err("Subject exceeds 1024 bytes".into());
        }
        if !intent.conditions.is_empty()
            || intent.time.len() != 1
            || intent.time[0].role != DateRole::TextActivity
            || !matches!(
                intent.time[0].relation,
                Relation::Within | Relation::Overlap
            )
        {
            return Err("Structured queries list/count notes with one text_activity period and no semantic conditions; use ordinary query search for other questions".into());
        }
        Ok(ResolvedQuery {
            intent: intent.clone(),
            periods: vec![self.resolve(&intent.time[0].period, DateRole::TextActivity)?],
            workflow: "note_inventory",
        })
    }
}

pub(crate) fn schema() -> Value {
    json!({"type":"object","additionalProperties":false,"required":["target","operation","time"],"properties":{
        "target":{"const":"notes"},
        "operation":{"enum":["list","count"]},
        "subject":{"type":["string","null"]},
        "conditions":{"type":"array","maxItems":0,"items":{"type":"string"}},
        "time":{"type":"array","minItems":1,"maxItems":1,"items":{"type":"object","additionalProperties":false,"required":["role","relation","period"],"properties":{
            "role":{"const":"text_activity"},
            "relation":{"enum":["within","overlap"]},
            "period":{"oneOf":[
                {"type":"object","additionalProperties":false,"required":["kind","unit","offset"],"properties":{"kind":{"const":"previous"},"unit":{"enum":["day","week","month"]},"offset":{"type":"integer","minimum":-120,"maximum":120}}},
                {"type":"object","additionalProperties":false,"required":["kind","unit","offset"],"properties":{"kind":{"const":"calendar"},"unit":{"enum":["day","week","month"]},"offset":{"type":"integer","minimum":-120,"maximum":120},"full":{"type":"boolean"}}},
                {"type":"object","additionalProperties":false,"required":["kind","start","end"],"properties":{"kind":{"const":"dates"},"start":{"type":"string"},"end":{"type":"string"}}},
                {"type":"object","additionalProperties":false,"required":["kind","amount","unit"],"properties":{"kind":{"const":"rolling"},"amount":{"type":"integer","minimum":1,"maximum":3660},"unit":{"enum":["hours","days"]}}}
            ]}
        }}}
    }})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn structured_queries_accept_only_note_activity_inventories() {
        let anchor = anchor("2026-09-14T16:00:00Z");
        let good = json!({"target":"notes","operation":"list","time":[{"role":"text_activity","relation":"within","period":{"kind":"calendar","unit":"week","offset":-1}}]});
        let accepts = |value: Value| {
            serde_json::from_value::<QueryIntent>(value)
                .ok()
                .is_some_and(|intent| anchor.normalize(&intent).is_ok())
        };
        assert!(accepts(good.clone()));
        for (field, value) in [
            ("target", json!("events")),
            ("operation", json!("compare")),
            ("conditions", json!(["completed"])),
            ("time", json!([])),
        ] {
            let mut query = good.clone();
            query[field] = value;
            assert!(
                !accepts(query),
                "unsupported field {field} activated structured routing"
            );
        }
        let mut query = good;
        query["time"][0]["role"] = json!("occurred");
        assert!(!accepts(query));
    }

    #[test]
    fn relative_request_guard_rejects_model_date_arithmetic_and_leaves_ambiguous_requests_alone() {
        let c = RequestedCalendar::from_question("What were the notes that I worked on last week?")
            .unwrap();
        let mut intent: QueryIntent = serde_json::from_value(json!({"target":"notes","operation":"list","time":[{"role":"text_activity","relation":"within","period":{"kind":"dates","start":"2026-08-31","end":"2026-09-06"}}]})).unwrap();
        assert!(c.validate(Some(&intent)).is_err());
        intent.time[0].period = Period::Calendar {
            unit: CalendarUnit::Week,
            offset: 0,
            full: false,
        };
        assert!(c.validate(Some(&intent)).is_err());
        intent.time[0].period = Period::Calendar {
            unit: CalendarUnit::Week,
            offset: -1,
            full: false,
        };
        assert!(c.validate(Some(&intent)).is_ok());
        for question in [
            "Which notes did I edit in the three days ending yesterday?",
            "Notes edited in the final hours during last week",
            "Notes edited this week last year",
            "Notes edited in the last week of August",
            "Notes edited on Tuesday last week",
            "Notes edited in the first half of last week",
            "Notes last month about meetings next month",
            "Notes from September 7–14, 2026",
            "Notes before last week",
            "Not last week",
            "Find the title `last week`",
            "Events since yesterday",
        ] {
            assert!(
                RequestedCalendar::from_question(question).is_none(),
                "{question}"
            );
        }
        for question in [
            "How many notes have recorded editing activity this week? List them.",
            "What were the notes that I worked on last week?",
            "Which notes did I edit today?",
            "Meetings next week",
            "Tasks due tomorrow",
            "Changes this month",
        ] {
            assert!(
                RequestedCalendar::from_question(question).is_some(),
                "{question}"
            );
        }
    }
    #[test]
    fn previous_periods_preserve_date_roles_and_exact_continuation_bounds() {
        let mut a = anchor("2026-09-14T16:00:00Z");
        let written = a
            .resolve(
                &Period::Calendar {
                    unit: CalendarUnit::Month,
                    offset: -1,
                    full: true,
                },
                DateRole::TextActivity,
            )
            .unwrap();
        let events = a
            .resolve(
                &Period::Calendar {
                    unit: CalendarUnit::Month,
                    offset: 1,
                    full: true,
                },
                DateRole::Occurred,
            )
            .unwrap();
        a.previous = vec![
            (DateRole::TextActivity, written),
            (DateRole::Occurred, events.clone()),
        ];
        let same = a
            .resolve(
                &Period::Previous {
                    unit: CalendarUnit::Month,
                    offset: 0,
                },
                DateRole::Occurred,
            )
            .unwrap();
        assert_eq!((same.after, same.before), (events.after, events.before));
        let before = a
            .resolve(
                &Period::Previous {
                    unit: CalendarUnit::Month,
                    offset: -1,
                },
                DateRole::Occurred,
            )
            .unwrap();
        let september = a
            .resolve(
                &Period::Dates {
                    start: "2026-09-01".into(),
                    end: "2026-09-30".into(),
                },
                DateRole::Occurred,
            )
            .unwrap();
        assert_eq!(
            (before.after, before.before),
            (september.after, september.before)
        );
        assert!(a
            .resolve(
                &Period::Previous {
                    unit: CalendarUnit::Week,
                    offset: -1
                },
                DateRole::Due
            )
            .is_err());
        a.previous.push((DateRole::Occurred, events));
        assert!(a
            .resolve(
                &Period::Previous {
                    unit: CalendarUnit::Week,
                    offset: -1
                },
                DateRole::Occurred
            )
            .is_err());
    }
    fn anchor(date: &str) -> QueryAnchor {
        QueryAnchor {
            instant: date.parse().unwrap(),
            timezone: "America/Denver".into(),
            previous: Vec::new(),
        }
    }
    #[test]
    fn calendar_boundaries_and_date_roles() {
        let a = anchor("2026-09-14T16:00:00Z");
        let p = a
            .resolve(
                &Period::Calendar {
                    unit: CalendarUnit::Week,
                    offset: -1,
                    full: false,
                },
                DateRole::TextActivity,
            )
            .unwrap();
        assert_eq!((p.after, p.before), (1788760800000, 1789365600000));
        let spring = anchor("2026-03-09T16:00:00Z");
        let day = spring
            .resolve(
                &Period::Calendar {
                    unit: CalendarUnit::Day,
                    offset: -1,
                    full: false,
                },
                DateRole::Occurred,
            )
            .unwrap();
        assert_eq!(day.before - day.after, 23 * 3600000);
        let rolling = spring
            .resolve(
                &Period::Rolling {
                    amount: 1,
                    unit: DurationUnit::Days,
                },
                DateRole::TextActivity,
            )
            .unwrap();
        assert_eq!(rolling.before - rolling.after, 24 * 3600000);
        let leap = a
            .resolve(
                &Period::Dates {
                    start: "2024-02-29".into(),
                    end: "2024-02-29".into(),
                },
                DateRole::Occurred,
            )
            .unwrap();
        assert_eq!(leap.before - leap.after, 86400000);
        assert!(a
            .resolve(
                &Period::Dates {
                    start: "2026-02-29".into(),
                    end: "2026-03-01".into()
                },
                DateRole::Occurred
            )
            .is_err());
        let p = Period::Calendar {
            unit: CalendarUnit::Week,
            offset: 0,
            full: false,
        };
        assert_eq!(
            a.resolve(&p, DateRole::TextActivity).unwrap().before,
            a.instant.timestamp_millis() as u64
        );
        assert!(
            a.resolve(&p, DateRole::Scheduled).unwrap().before
                > a.instant.timestamp_millis() as u64
        );
    }
}
