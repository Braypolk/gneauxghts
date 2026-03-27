testing  
one two three
# one

## two

---

# Markdown convention sampler

Use this file to preview how your editor or renderer treats headings, lists, code, tables, and extensions.

## ATX Headings (using `#`)

### Third Level

#### Fourth Level

##### Fifth Level

###### Sixth Level (smallest)

// Setext-style headings (using underlines)

Top-level title
===============

Second level
------------

## Emphasis

- *italic* or _italic_
- **bold** or __bold__
- ***bold italic***
- ~~strikethrough~~ (GFM)
- `inline code` with backticks

## Links and images

- Inline: [Example link](https://example.com)
- With title: [Hover for title](https://example.com "tooltip text")
- Reference-style: [Reference link][ref]

[ref]: https://example.com "optional title"

- Image: ![Alt text for screen readers](https://via.placeholder.com/120x40 "optional image title")

## Lists

Unordered:

- Apples
- Oranges
  - Nested item
  - Another nested

Ordered:

1. First
2. Second
   1. Sub-step (some renderers)
3. Third

Task list (GFM):

- [x] Done
- [ ] Todo
- [ ] Another

## Blockquote

> Single paragraph quote.

> Multi-line quote  
> with a line break (two spaces at end of line, or `<br>`).

> Nested:
>
> > Inner quote

## Code

Fenced block with language tag:

```typescript
function greet(name: string): string {
  return `Hello, ${name}`;
}
```

Indented code block (four spaces — less common now):

    line one
    line two

## Table (GFM)

| Column A | Column B | Align   |
| -------- | :------: | ------: |
| left     |  center  |   right |
| `code`   | **bold** |   123   |

## Horizontal rules

Three or more:

---

***

___

## Footnotes (many GFM renderers)

Here is a sentence with a footnote.[^note]

[^note]: Footnote text appears at the bottom.

## Autolink (GFM)

Bare URLs can auto-link: <https://example.com>

## Escaping

Show literal asterisks: \*not italic\* and \`not code\` depending on renderer.
