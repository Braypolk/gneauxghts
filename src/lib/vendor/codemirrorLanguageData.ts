import { LanguageDescription } from '@codemirror/language';
import { languages as allLanguages } from '@codemirror/language-data';

// Curated subset of CodeMirror's language catalog used for fenced-code-block
// syntax highlighting. `LanguageDescription` entries are lazy: the parser for a
// language is only fetched when a code block actually uses it, so listing a
// language here does not eagerly add it to the bundle. We keep the list focused
// on the languages a notes app realistically sees rather than shipping the full
// catalog and its alias surface.
const CURATED_LANGUAGE_NAMES = new Set([
  'JavaScript',
  'TypeScript',
  'JSX',
  'TSX',
  'JSON',
  'HTML',
  'CSS',
  'Sass',
  'Python',
  'Rust',
  'Go',
  'Java',
  'C',
  'C++',
  'C#',
  'Shell',
  'YAML',
  'TOML',
  'Markdown',
  'SQL',
  'XML',
  'PHP',
  'Ruby',
  'Swift',
  'Kotlin',
  'Dart'
]);

export const languages: readonly LanguageDescription[] = allLanguages.filter((language) =>
  CURATED_LANGUAGE_NAMES.has(language.name)
);
