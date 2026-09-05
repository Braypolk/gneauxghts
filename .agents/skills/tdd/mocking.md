# Choosing test doubles

Keep the behavior under investigation real. Use substitutes where they make a
test deterministic or avoid unavailable, expensive, or externally consequential
operations: network services, clocks, randomness, and selected filesystem or
database failures. Prefer a temporary real store for persistence behavior.

For a race, a controlled promise, clock, or failure at an existing interface can
hold one operation at the required point. Keep the coordinating modules real;
mocking the coordination itself would erase the defect.

Internal collaborators may be substituted when their behavior is outside the
test's purpose. Explain a non-obvious substitution, and cover the production
integration separately when the substitute omits relevant behavior. Prefer
observable outcomes over assertions about a particular chain of internal calls.
Call order and counts are useful when ordering or duplicate effects are the
contract being tested.

Reuse existing dependency injection and adapters. Add a new interface only when
it hides real complexity or enables a necessary test; mock convenience alone
is insufficient reason to redesign production code.
