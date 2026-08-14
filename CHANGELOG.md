# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Git status where the writing happens: a letter badge (`M`, `A`, `?`, `D`,
  `R`) on every tree row and in the pane header, refreshed on the folder
  watcher and on save, debounced. Backed by the `git` binary through
  `child_process`, never a native library. With no git on PATH, or outside a
  repository, the feature is simply absent: no error, no empty state.
- Read only diff view, from the palette ("view file diff") and from an icon in
  the pane header. Added and removed lines are tinted with colors derived from
  the active theme and measured to stay between 4.5:1 and 11:1. An untracked
  file is shown as its whole content added. No staging and no commit UI: the
  embedded terminal already covers that.
- `wired`, an experimental CLI so an AI agent can drive the editor from the
  terminal it already lives in: `wired open`, `wired focus`, `wired list`
  (`--json` for machine output) and `wired new`. No daemon, no server and no
  port: the app is single instance now, and a second invocation hands its argv
  to the live window. `skills/wired-md/SKILL.md` teaches an agent to use it.
- `aiCliCommand` config key (default `claude`): the AI bridge and the terminal
  button bring up whichever CLI is configured, and the tooltips say which one.
  The bridge still never presses Enter on the final prompt line, with any CLI.

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
