//! App-authored interpretation rules, delivered once per independent runtime's
//! evidence session. Selection is structural, never inferred from user wording.
use serde_json::Value;

const SOURCE_SCOPE: &str = "Source scope: A named note is a starting point for factual questions. Search related notes for unresolved facts and attribute their answers. When asked what a named note records, check its complete canonical content before calling a detail unrecorded there. Finish when requested facts are supported or gaps are stated.";
const PROSE: &str = "Evaluate each action's actor, status, and event date before grouping it. Explicit prose outcomes can establish recorded completion without a checkbox; completed substeps do not complete their parent project. Match the request: work in progress belongs in activity answers, supported completions in completion answers. Plans, requests, due dates, and proposed ideas are not completed actions or automatic commitments. A recorded discussion can itself be activity. Attribute only the action linked to an actor; neighboring passive clauses can have unknown actors. Source event dates, including unambiguous journal headings, differ from text-change dates. Resolve relative dates against explicit authored context; otherwise keep timing unknown. Explicit corrections supersede their identified claim; unresolved conflicts stay visible. Missing completion evidence means unestablished, not failed or definitely unfinished. Use ordinary calendar or period-relative wording without inventing exact dates from numeric or uncertain timestamps. Unknown event timing stays unknown in the conclusion; do not call it likely within the period. Do not choose a conflicting account merely because it was edited last.";
const CHECKBOX: &str = "Checkbox facts: currentStatus is the current checkbox state. Count a task as recorded complete in the requested interval only if it is completed and statusMarkerChangedInPeriod is true. False does not establish a new completion; null leaves timing unknown. Preserve statusMarkerTimeUncertain and Editing Window intervals. A restored marker is not a new accomplishment. Wording edits, text introducedAt, and knownSince do not date completion. matchedRangeIncludesStatusMarker identifies marker-bearing excerpts; deduplicate the same task and prefer that excerpt for its completion citation. An open or reopened task does not establish its earlier completion history. A removed task does not establish completion. These facts describe checkbox records, not when real-world work happened.";
const DEADLINES: &str = "taskDates inventories actual checkbox lines in the delivered current passage. Use exact checkbox text; fenced-code examples are not tasks. null dueDate means no supported explicit deadline; complete=false means omitted lines, and missing metadata establishes no complete inventory. dueDate is a Gregorian calendar date with no time or UTC conversion. The parser uses the first valid annotation; children do not inherit dates. Invalid, escaped, code, link annotations, and ordinary dates are prose. Relative to the run's local calendar day, open tasks are overdue before today, due today on today, and upcoming after today; completed tasks are not actionable overdue work. Use current evidence to assess current deadlines, and report material missing or unknown dates. An activity_range filters text changes, not due dates.";

#[derive(Clone, Copy, Default)]
pub(super) struct Guidance(u8);
impl Guidance {
    fn applicable(items: &[Value]) -> u8 {
        u8::from(!items.is_empty())
            | if items.iter().any(|item| !item["task"].is_null()) {
                2
            } else {
                0
            }
            | if items.iter().any(|item| !item["taskDates"].is_null()) {
                4
            } else {
                0
            }
    }
    pub(super) fn pending(self, items: &[Value]) -> Vec<&'static str> {
        let missing = Self::applicable(items) & !self.0;
        [(1, SOURCE_SCOPE), (1, PROSE), (2, CHECKBOX), (4, DEADLINES)]
            .into_iter()
            .filter_map(|(flag, text)| (missing & flag != 0).then_some(text))
            .collect()
    }
    pub(super) fn record(&mut self, items: &[Value]) {
        self.0 |= Self::applicable(items);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn interpretation_contracts_follow_delivered_structure_once_per_session() {
        let mut delivered = Guidance::default();
        assert!(delivered.pending(&[]).is_empty());
        let prose = [json!({"excerpt":"ordinary prose"})];
        assert_eq!(delivered.pending(&prose), vec![SOURCE_SCOPE, PROSE]);
        delivered.record(&prose);
        assert!(delivered.pending(&prose).is_empty());
        let task = [json!({"task":{}, "taskDates":{}})];
        assert_eq!(delivered.pending(&task), vec![CHECKBOX, DEADLINES]);
        delivered.record(&task);
        assert!(delivered.pending(&task).is_empty());
        assert_eq!(Guidance::default().pending(&task).len(), 4);
    }
}
