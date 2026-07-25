export interface ParsedWikilink {
  target: string;
  alias: string | null;
  separatorOffset: number | null;
}

export function parseWikilink(rawTarget: string): ParsedWikilink {
  const separatorOffset = rawTarget.indexOf('|');
  if (separatorOffset < 0) {
    return { target: rawTarget.trim(), alias: null, separatorOffset: null };
  }

  const target = rawTarget.slice(0, separatorOffset).trim();
  const alias = rawTarget.slice(separatorOffset + 1).trim();
  return {
    target,
    alias: target && alias ? alias : null,
    separatorOffset
  };
}
