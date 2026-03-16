export interface ParsedNoteDocument {
  title: string;
  bodyMarkdown: string;
}

export function parseStoredMarkdown(markdown: string): ParsedNoteDocument {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const firstContentLineIndex = lines.findIndex((line) => line.trim() !== '');

  if (firstContentLineIndex === -1) {
    return { title: '', bodyMarkdown: '' };
  }

  const firstContentLine = lines[firstContentLineIndex];
  const headingMatch = firstContentLine.match(/^#\s+(.*)$/);

  if (!headingMatch) {
    return { title: '', bodyMarkdown: normalized };
  }

  const remainingLines = lines.slice(firstContentLineIndex + 1);
  if (remainingLines[0]?.trim() === '') remainingLines.shift();

  return {
    title: headingMatch[1].trim(),
    bodyMarkdown: remainingLines.join('\n')
  };
}

export function composeMarkdown(noteTitle: string, noteBody: string) {
  const normalizedBody = noteBody.replace(/\r\n/g, '\n');
  const trimmedTitle = noteTitle.trim();

  if (!trimmedTitle) return normalizedBody;

  const bodyWithoutLeadingSpace = normalizedBody.replace(/^\n+/, '');
  return bodyWithoutLeadingSpace ? `# ${trimmedTitle}\n\n${bodyWithoutLeadingSpace}` : `# ${trimmedTitle}`;
}
