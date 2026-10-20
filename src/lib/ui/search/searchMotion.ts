/** Ordinary Search content expansion and the shared results popup reveal. */
export const searchExpansionDuration = 460;
export const searchExpansionBezier = [0.32, 0, 0.2, 1] as const;
export const searchExpansionStyles = `--search-expansion-duration:${searchExpansionDuration}ms;--search-expansion-ease:cubic-bezier(${searchExpansionBezier.join(', ')})`;
