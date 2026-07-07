export interface TextSearchOptions {
  matchCase?: boolean;
  matchWholeWord?: boolean;
}

const WORD_CHARACTER_PATTERN = /\p{L}|\p{N}|_/u;

export function textMatchesSearch(text: string, query: string, options: TextSearchOptions = {}) {
  const normalizedQuery = options.matchCase ? query.trim() : query.trim().toLowerCase();
  if (normalizedQuery === '') return true;

  const normalizedText = options.matchCase ? text : text.toLowerCase();
  let index = normalizedText.indexOf(normalizedQuery);

  while (index !== -1) {
    const end = index + normalizedQuery.length;
    if (!options.matchWholeWord || isWholeWordSearchMatch(normalizedText, index, end)) {
      return true;
    }
    index = normalizedText.indexOf(normalizedQuery, index + normalizedQuery.length);
  }

  return false;
}

export function isWholeWordSearchMatch(text: string, from: number, to: number) {
  const before = from > 0 ? text[from - 1] : '';
  const after = to < text.length ? text[to] : '';
  return !WORD_CHARACTER_PATTERN.test(before) && !WORD_CHARACTER_PATTERN.test(after);
}
