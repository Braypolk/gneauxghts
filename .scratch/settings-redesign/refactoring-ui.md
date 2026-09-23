# Refactoring UI: settings refinement

Reviewed 2026-09-22. Sources are the authors’ public material, not unofficial book copies. The applications below are design judgments for Gneauxghts.

1. **Give each screen a clear reading order.** The authors recommend using weight and contrast alongside size to establish importance. Apply this with a compact page title, readable setting labels, and quieter supporting text. Avoid making every heading, description, badge, and button compete. [Authors’ practical tips, section 1](https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886)

2. **Remove redundant display labels.** Context or a combined value can often replace a separate label. For example, show “12 notes indexed” without another “Indexed notes” heading. Keep form labels: the preview explicitly says this advice is not about forms. In settings, retain labels users scan for; remove explanatory sentences that merely repeat them. [Official labels preview](https://refactoringui.com/previews/labels-are-a-last-resort)

3. **Let the important action stand out.** The authors distinguish primary, secondary, and tertiary actions by visual prominence. Apply one strong treatment to a required setup or save action; keep refresh and maintenance quiet. A healthy, ready screen does not need a prominent action just to fill space. [Authors’ practical tips, section 7](https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886)

4. **Separate groups without boxing everything.** The authors suggest spacing and different backgrounds as alternatives to excess borders. Apply one coherent settings surface with grouped rows, rather than a card around every instruction and control. Keep clear control boundaries and focus indicators. [Official site, “Design with tactics”](https://refactoringui.com/)

5. **Make density deliberate.** The official preview links line spacing to both line length and font size. Apply shorter helper copy and restrained content widths before shrinking text or squeezing line-height. Keep enough room to scan wrapped labels on mobile. [Official line-height preview](https://refactoringui.com/previews/line-height-is-proportional)

6. **Keep essential meaning; reduce repeated explanation.** As an application of the hierarchy and label principles, show a concise current state and any required next step. Put occasional technical explanations in searchable details. Preserve warnings, credential handling, restart requirements, and the distinction between active indexing and idle readiness. [Official labels preview](https://refactoringui.com/previews/labels-are-a-last-resort), [authors’ practical tips](https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886)

Acceptance checks: every control still has an accessible name; search still reaches concealed settings; required actions remain visible; a ready state reads as complete; screen hierarchy survives light/dark themes and narrow widths.
