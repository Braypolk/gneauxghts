//! Application-owned capability composition. Restrictions only remove authority;
//! output presentation and worker identity are independent of the tool registry.
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Capability {
    Evidence,
    WorkingNotes,
    Proposals,
    Research,
    Planning,
}

#[derive(Clone)]
pub(crate) struct Capabilities(BTreeSet<Capability>);
impl Capabilities {
    pub(crate) fn assistant() -> Self {
        Self(BTreeSet::from([
            Capability::Evidence,
            Capability::WorkingNotes,
            Capability::Proposals,
            Capability::Research,
            Capability::Planning,
        ]))
    }
    pub(crate) fn restricted_to(&self, allowed: &[Capability]) -> Self {
        Self(
            self.0
                .iter()
                .copied()
                .filter(|entry| allowed.contains(entry))
                .collect(),
        )
    }
    pub(crate) fn contains(&self, capability: Capability) -> bool {
        self.0.contains(&capability)
    }
    pub(crate) fn iter(&self) -> impl Iterator<Item = Capability> + '_ {
        self.0.iter().copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_capabilities_compose_and_nested_restrictions_never_restore_authority() {
        let parent =
            Capabilities::assistant().restricted_to(&[Capability::Evidence, Capability::Planning]);
        assert_eq!(
            parent.iter().collect::<Vec<_>>(),
            vec![Capability::Evidence, Capability::Planning]
        );
        let child = parent.restricted_to(&[
            Capability::Evidence,
            Capability::Proposals,
            Capability::Research,
        ]);
        assert_eq!(child.iter().collect::<Vec<_>>(), vec![Capability::Evidence]);
        assert_eq!(
            child.restricted_to(&[Capability::Proposals]).iter().count(),
            0
        );
        assert_eq!(
            parent.iter().count(),
            2,
            "a child does not mutate its parent's capabilities"
        );
    }
}
