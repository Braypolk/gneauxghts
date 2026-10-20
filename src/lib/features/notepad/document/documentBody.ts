import { Text } from '@codemirror/state';

/** Immutable authored body. Safe to retain across awaits and editor teardown.
 * Strings are snapshots for boundary consumers, never a second live owner. */
export class DocumentBody {
  readonly text: Text;
  #markdown: string | undefined;
  #hasContent: boolean | undefined;
  readonly #equal = new WeakMap<DocumentBody, boolean>();

  private constructor(text: Text, markdown?: string) {
    this.text = text;
    this.#markdown = markdown;
  }

  static fromMarkdown(markdown: string) {
    // Preserve exact boundary bytes, including CR characters and trailing lines.
    return new DocumentBody(Text.of(markdown.split('\n')), markdown);
  }

  static fromText(text: Text) {
    return new DocumentBody(text);
  }

  get length() { return this.text.length; }

  toMarkdown(): string {
    return this.#markdown ??= this.text.toString();
  }

  equals(other: DocumentBody): boolean {
    if (this === other || this.text === other.text) return true;
    if (this.length !== other.length) return false;
    let equal = this.#equal.get(other);
    if (equal === undefined) {
      equal = this.text.eq(other.text);
      this.#equal.set(other, equal);
    }
    return equal;
  }

  /** Matches markdown.trim() !== '' without materializing the body. */
  hasContent(): boolean {
    if (this.#hasContent !== undefined) return this.#hasContent;
    for (const chunk of this.text.iter()) {
      if (/\S/u.test(chunk)) return this.#hasContent = true;
    }
    return this.#hasContent = false;
  }
}
