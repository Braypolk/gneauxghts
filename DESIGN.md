---
name: Gneauxghts
description: A quiet, local-first Markdown notes app where context brings notes back to you.
colors:
  paper: "oklch(0.9900 0 0)"
  ink: "oklch(0 0 0)"
  card: "oklch(1 0 0)"
  muted-surface: "oklch(0.9700 0 0)"
  soft-control: "oklch(0.9400 0 0)"
  muted-ink: "oklch(0.4400 0 0)"
  border: "oklch(0.9200 0 0)"
  destructive: "oklch(0.6300 0.1900 23.0300)"
  dark-paper: "oklch(0 0 0)"
  dark-ink: "oklch(1 0 0)"
  dark-card: "oklch(0.1800 0 0)"
  dark-muted-surface: "oklch(0.2300 0 0)"
  dark-soft-control: "oklch(0.3200 0 0)"
  dark-muted-ink: "oklch(0.7200 0 0)"
  dark-border: "oklch(0.3500 0 0)"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0"
  headline:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0"
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
rounded:
  sm: "0.4rem"
  md: "0.5rem"
  lg: "1.1rem"
  panel: "1.5rem"
  sheet: "1.8rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1rem"
  search-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.375rem 0.75rem"
  panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "1rem"
---

# Design System: Gneauxghts

## 1. Overview

**Creative North Star: "The Contextual Notebook"**

Gneauxghts should feel like a calm Markdown notebook that understands context without announcing itself. The interface is quiet, fast, and interconnected: writing stays central, retrieval sits close at hand, and intelligent surfaces appear as practical utilities rather than branded AI features.

The system is personal software, not an enterprise workspace. It rejects Notion's do-everything sprawl, dashboard density for its own sake, and any visual language that makes the app feel design-led instead of notes-led.

**Key Characteristics:**
- Monochrome paper-and-ink palette with semantic red reserved for destructive action.
- Rounded, tactile controls that support repeated keyboard and pointer use.
- Dense but calm panels for search, tasks, settings, and related notes.
- Tonal layering first; shadows only where a surface genuinely floats.
- Intelligence appears as context, not marketing.

## 2. Colors

The palette is monochrome paper and ink: foreground acts as the primary action color, neutral layers separate surfaces, and red is reserved for irreversible actions.

### Primary
- **Ink**: The main action, selection, active-tab, and text color. In light mode this is black; in dark mode it inverts to white.

### Neutral
- **Paper**: The app background and quiet writing surface.
- **Card**: The primary container surface for editor cards, task groups, settings panels, popovers, and bottom chrome.
- **Muted Surface**: Low-emphasis fills for empty states, hover affordances, chips, and inactive grouped controls.
- **Soft Control**: Slightly stronger fill for segmented controls and secondary button backgrounds.
- **Muted Ink**: Secondary labels, helper copy, placeholders, metadata, and inactive navigation.
- **Border**: Thin structure around panels and controls. Borders should read as quiet separation, not decoration.

### Secondary
- **Destructive Red**: Used only for delete, forget, error, and destructive confirmation states.

### Named Rules

**The Monochrome Trust Rule.** The default app should work in paper, ink, and neutral layers. Do not introduce decorative accent colors unless a state or semantic role requires them.

**The Quiet AI Rule.** Semantic and AI-assisted features must use the normal palette. Never give them a special neon, gradient, badge, or campaign treatment.

## 3. Typography

**Display Font:** Geist, sans-serif  
**Body Font:** Geist, sans-serif  
**Label/Mono Font:** Geist Mono for inline code and fenced code; Georgia is available as a serif token but is not part of the product UI vocabulary.

**Character:** The type system is compact, modern, and utilitarian. It should feel native to a focused desktop tool: enough weight for scanability, never enough styling to distract from the note.

### Hierarchy
- **Display** (700, 1.75rem, 1.3): Markdown H1 and the largest note-level headings.
- **Headline** (700, 1.375rem, 1.35): Markdown H2 and major panel headings when space allows.
- **Title** (600, 1rem, 1.5): Section titles, note names, task group titles, and primary list text.
- **Body** (400, 0.875rem, 1.6): Settings copy, excerpts, task text, panel descriptions, and supporting UI prose.
- **Label** (600, 0.6875rem, 0.16em): Metadata labels and short uppercase group headers. Use sparingly.

### Named Rules

**The Note-First Type Rule.** Editor content gets the strongest type hierarchy. Chrome, panels, and settings stay compact so they do not compete with writing.

## 4. Elevation

Gneauxghts uses tonal layering with restrained lift. Borders, background opacity, and surface contrast establish most hierarchy. Shadows appear on floating chrome such as the navigation pill, bottom bar, popovers, active controls, and settings containers.

### Shadow Vocabulary
- **Subtle Resting Lift** (`0px 1px 2px 0px hsl(0 0% 0% / 0.09)`): Small controls and active navigation items.
- **Panel Lift** (`0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 2px 4px -1px hsl(0 0% 0% / 0.18)`): Cards and app panels that need separation from the page.
- **Popover Lift** (`0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 8px 10px -1px hsl(0 0% 0% / 0.18)`): Search results, confirmations, and floating pickers.

### Named Rules

**The Lift Only When Floating Rule.** A surface at rest should usually be separated by tone and border. Use shadow only when the element is physically above the workspace or actively selected.

## 5. Components

### Buttons

Buttons are soft utility controls: pill-shaped, compact, and optimized for repeated use.

- **Shape:** Fully rounded pills for primary actions and icon buttons; small internal editor surfaces may use gently curved corners.
- **Primary:** Foreground fill with background text, used for selected tabs, active segmented controls, and strong actions.
- **Hover / Focus:** Shift neutral fills toward accent/foreground contrast. Keep transitions short and color-based.
- **Destructive:** Red is allowed only for forget/delete/error confirmation flows.

### Chips

- **Style:** Rounded neutral pills with muted text. Active chips invert to foreground/background.
- **State:** Selection should be obvious through fill and text contrast, not through extra decoration.

### Cards / Containers

- **Corner Style:** Large rounded panels for app sections and related-note surfaces.
- **Background:** Card and translucent card layers over the app background.
- **Shadow Strategy:** Use panel or popover lift only for floating or selected surfaces.
- **Border:** Thin neutral borders are the default container boundary.
- **Internal Padding:** Dense but breathable, usually 1rem to 1.5rem.

### Inputs / Fields

- **Style:** Search and text inputs use pill or transparent forms with neutral borders.
- **Focus:** Focus should preserve layout and clarify keyboard position. Avoid thick rings that make the bottom bar feel jumpy.
- **Error / Disabled:** Error states use destructive red; disabled states reduce opacity and keep the same shape vocabulary.

### Navigation

Navigation uses a small pill group centered in the title area, with icon-first controls on compact screens and icon-plus-label controls on wider screens. Active navigation uses card fill, foreground text, and subtle shadow; inactive navigation stays muted until hover.

### Signature Component: Bottom Search Bar

The bottom bar is the command surface. It combines search, recent notes, recent tasks, mode toggles, forget/unforget, and new-note action in one restrained piece of chrome. It may use backdrop blur and popover lift because it floats over the editor, but it must remain visually quiet.

### Signature Component: Related Panel

The related panel should feel like contextual recall, not an AI feature panel. It uses the same card, border, pill toggle, and muted metadata vocabulary as the rest of the app.

## 6. Do's and Don'ts

### Do:

- **Do** keep the note at the center; editor content gets priority over surrounding chrome.
- **Do** use paper, ink, neutral surfaces, thin borders, and restrained shadows as the default visual language.
- **Do** preserve keyboard-first workflows with visible focus and stable layouts.
- **Do** use red only for destructive or error states.
- **Do** make semantic search and related-note features feel like context appearing at the right moment.

### Don't:

- **Don't** make Gneauxghts feel like Notion's broad do-everything workspace.
- **Don't** make it feel like enterprise software, a dashboard suite, or an AI-forward product that constantly markets its intelligence.
- **Don't** add decorative gradients, glassy effects, neon AI accents, or feature badges for intelligence.
- **Don't** use heavy color on inactive states or decorate list items with colored side stripes.
- **Don't** let rounded panels nest into more rounded panels until the interface becomes a stack of cards.
