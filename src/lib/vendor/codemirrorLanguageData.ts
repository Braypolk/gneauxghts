import type { LanguageDescription } from '@codemirror/language';

// Draftly's CodePlugin falls back to plain-text rendering when no parser matches.
// Keeping this list empty avoids shipping the full CodeMirror language catalog.
export const languages: readonly LanguageDescription[] = [];
