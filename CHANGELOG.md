# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `scripts/measure-contrast.mjs`: a build time gate that parses every theme in
  `themes/` and asserts that each ink over each surface the app really renders
  stays between 4.5:1 and 11:1 (the floor is WCAG AA, the ceiling exists because
  the maintainer has astigmatism and glare costs as much legibility as murk). It
  handles the pairings that need alpha composition, prints a table, and exits
  non-zero on any violation. Run it after touching any color.
- Three themes, all measured: `carbon` (high contrast dark, cold blue accent),
  `parchment` (warm sepia paper, cool indigo accent) and `ash` (mid gray, warm
  amber accent).
- Settings v2: the overlay is now four icon tabs (Appearance, Editor, Terminal
  and AI, Shortcuts) instead of one long scroll, each tab carrying a tooltip and
  an accessible name, with arrow key navigation and a roving tabindex. The gear
  stays in the sidebar footer. The Terminal and AI tab is an intentional
  placeholder.
- Theme variable panel under Appearance: every `:root` color the active theme
  declares, grouped, editable in place, with per row reset and reset all.
  Overrides persist per theme name in `config.themeOverrides` and apply through
  the `#custom-style` layer, below CSS snippets. Every commit runs a live
  contrast check and shows an inline amber warning row when a text pairing
  leaves the 4.5 to 11 band; it warns, it never blocks, and it is never a popup.
- Import theme: a file picker that copies a `.css` into the themes folder and
  refreshes the selector. An existing name is never overwritten (it becomes
  `name (2).css`).
- Motion tokens (`--t-fast`, `--t-med`, `--t-slow`, `--ease`), all under 180ms,
  replacing scattered magic durations, and a `prefers-reduced-motion` block that
  keeps every state while removing the travel between them.

### Changed

- Empty states (sidebar, recents, search results, command palette, template
  list, no pane) are a centered icon with a short hint instead of one gray line
  of text flush left.
- Consistent hover, active and `:focus-visible` states across every button and
  control, plus a scrollbar thumb that can actually be seen (it was `--rule-soft`
  at 1.13:1 against its own surface).
- The unsaved dot scales in once rather than appearing between two frames, and a
  collapsed pane spine answers the pointer before you click it.
- `claro.css`, the pre rename seed, is retired from the user themes folder at
  startup when it is byte for byte what the app shipped, via `shell.trashItem`
  (never `unlink`). A copy the user edited is left untouched.

### Fixed

- Five contrast defects in `light.css` that the new gate caught on its first
  run: `--ink-faint` at 3.58:1 over `--bg-3`, `--accent-soft` at 4.44:1, and
  `--green`, `--amber` and `--red` all under the floor over `--bg-2`.
- The close button's hover glyph was a hardcoded `#1c1113`, measured once
  against the wired red and then inherited by every other theme (3.41:1 in the
  light theme, well under the floor). It is now the measured `--win-close-ink`.
- `applyCustom` measured the focus mode dim BEFORE writing the new variables, so
  the opacity always described the previous palette. It now writes, measures,
  then rewrites.
- Four of the seven `!important` declarations fighting Vditor were unnecessary
  (`styles.css` already loads after Vditor's stylesheet) and one is now handled
  with specificity against the lazy loaded highlight.js theme. The three that
  remain each beat an inline style, which specificity cannot reach.

## [0.1.0] - 2026-08-13

First working version. The app was built from scratch in phased milestones;
the entries below are grouped by feature area rather than by individual phase.

### Added

- Inline WYSIWYG markdown editing (Typora style) using Vditor's instant
  rendering mode, dark theme by default.
- Live customization: custom themes (`.css` files defining color variables,
  with `wired` dark and `claro` shipped by default), toggleable CSS snippets,
  and controls for accent color, document font, code font, and text size. All
  state persists to `%APPDATA%\wired-md\config.json`.
- Embedded terminal (Ctrl+`) opening in the current file's directory, backed by
  node-pty with a pipe based fallback. A button types `claude` into the shell.
- Frameless window with a custom, icon only title bar (Obsidian style),
  custom window controls, and window size, position, and maximized state
  persisted between sessions. Default size 700x840.
- Bundled studio fonts, offline: Geist, Geist Mono, Mona Sans, Inter, and
  Satoshi, each under its own license.
- Obsidian style sidebar with a real file tree of the open note's folder
  (markdown only), auto refreshing on disk changes via `fs.watch`, a Recents
  section, a header with the root folder name and an Explorer shortcut, a
  toolbar (new file, new folder, sort, collapse all, filter), and a custom
  right click context menu (rename, duplicate, export, copy path, delete to
  the Recycle Bin). Resizable and hideable.
- Sliding panes: up to four files side by side, each with its own save and
  dirty state. The active pane stays wide; panes that no longer fit collapse
  into a 40px vertical spine that expands on click. Layout recomputes on
  window resize.
- Command palette (Ctrl+Shift+P) and quick switcher (Ctrl+P) with fuzzy
  subsequence search; Ctrl+Enter opens beside.
- claude bridge per note: a per pane action opens the terminal, brings up
  `claude`, runs `/cd` into the note's folder, and types the file path into
  the prompt without sending. The palette can send the current selection.
- Document font zoom (Ctrl+=, Ctrl+-, Ctrl+0, and Ctrl+scroll), persisted.
- Resizable terminal panel (drag its top edge), height persisted.
- Full text search across the folder (Ctrl+Shift+F) powered by a bundled
  ripgrep binary, with a pure Node fallback, grouped and keyboard navigable
  results with highlighted snippets.
- Frontmatter properties panel: editable fields for a leading YAML block, with
  automatic schema selection (`skill`, `subagent`, generic), quiet inline
  validation warnings, and lossless round trip preserving key order, comments,
  and nested maps.
- New file from template with variables: `.md` templates seeded into the user
  folder (skill, subagent, `CLAUDE.md`, dated note), variable substitution
  (`{{data}}`, `{{hora}}`, `{{titulo}}`, `{{pasta}}`, `{{cursor}}`,
  `{{pergunta:label}}`), and safe cancellation at any step.
- Focus mode (F8) and typewriter mode (F9), two independent toggles. Focus
  dims non active blocks with a measured opacity that keeps faded text above
  the 4.5:1 contrast floor; typewriter keeps the current line centered.
  Neither interferes with manual scrolling.
- Inline math deliberately disabled so a dollar sign reads as money, not a
  formula; block math (`$$...$$`) still works.
- End to end test suite driving the real app (59 checks) plus a non
  interactive smoke test.

[Unreleased]: https://github.com/gabrielsilvestri/wired-md/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gabrielsilvestri/wired-md/releases/tag/v0.1.0
