# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An open note follows its file on disk. When another tool (claude in the
  embedded terminal, an agent driving the `wired` CLI, another editor) changes
  a file open in any tab or group, a tab with no unsaved edits reloads in place,
  stays clean, keeps its scroll position and does not take the focus. A tab
  with unsaved edits shows an inline row with "Reload from disk" and "Keep
  mine" instead, and nothing is overwritten silently in either direction.
  Ctrl+S never writes over a newer version on disk. A file deleted or renamed
  away keeps its tab open with a row saying so, and the next save recreates it.
  "Compare" in that row, and "what changed on disk" in the palette after a
  silent reload, show what the other tool changed as a diff, unchanged lines
  folded.
- A status bar under the editor with words, characters and an approximate
  token count (characters divided by four, labeled as an estimate; the
  frontmatter counts for tokens but not for words), plus the words and tokens
  selected.
- An outline section in the sidebar: the active note's headings, indented by
  level, following the caret, jumping on click, each with the token estimate
  of its section in the tooltip. Headings inside code fences are skipped. Both the outline and the status bar toggle from the palette.
- Links go somewhere. Ctrl+click opens http, https and mailto links in the
  browser, relative Markdown links in a tab (a `#heading` suffix scrolls to
  it) and `#anchors` in place; a missing note gets an inline status. The
  window can no longer navigate away or open new windows.
- Relative images (`![](assets/pic.png)`) render beside the note without the
  Markdown changing. Pasting or dropping an image into a saved note writes it
  to `assets/<note>-<stamp>.<ext>` next to the note and links it at the caret;
  dropping a `.md` file opens it in a tab.
- A theme gallery in Settings > Appearance (and "browse themes" in the
  palette): ten themes that ship with the app (deep-ink, frost, low-glow,
  moss, retro, rosewood, solar-night, fog, paper, solar-day), each previewed
  from its own colors and kept inside the 4.5:1 to 11:1 contrast band.
  Installing copies the file into your themes folder and never replaces one
  already there. The contrast gate measures the catalog too.
- Line height (1.4 to 2.0) and text width (560 to 1200px, or full width) in
  Settings > Editor, live and persisted.
- A first run welcome: pick the AI CLI the sparkles button brings up (claude,
  codex, gemini, aider, opencode, cursor-agent, qwen, each marked found on
  PATH or not, or any command), a theme with a live preview and the document
  font. Skip or Esc closes it for good, and "welcome and setup" in the palette
  brings it back. Its footer links to the repository and to Buy me a coffee.
- Unsaved edits survive a crash. While a tab has unsaved changes a snapshot of
  its text is kept in `%APPDATA%\wired-md\recovery` and removed once the tab
  is saved or closed clean. Snapshots found at launch come back as unsaved tabs
  with an inline note (a new tab when the file itself is gone). "Don't save" on
  close throws them away, so discarded edits never return.
- Tool names in `tools`, `disallowedTools` and `allowed-tools` are checked
  against Claude Code's documented tool list: a wrong case (`bash`) and an
  unknown name are flagged inline, a scoped permission (`Bash(git status:*)`)
  is checked by its name and MCP tools (`mcp__server__tool`) pass.
- A restored session reopens every note where it was scrolled to.
- A right click menu inside the note. Electron draws none, so a right click in
  the text did nothing; now it offers cut and copy (with a selection), paste,
  select all, sending the selection to the AI CLI, find in note, and on a link
  open link and copy link address. Paste is a real paste, so pasted images are
  saved like any other.
- CLAUDE.md imports in the editor. In a `CLAUDE.md`, `CLAUDE.local.md` or
  `AGENTS.md`, the status bar adds what its `@path` imports bring into the
  context (four hops deep, as Claude Code loads them; code spans, fences and
  email addresses are not imports; `\ ` escapes a space), with every file and
  its share in the tooltip and a missing import flagged in amber. Ctrl+click
  on an `@path` opens it.
- Custom slash commands get their own properties schema: a file under
  `.claude/commands/` offers `description`, `argument-hint`, `allowed-tools`
  and `model` first and flags a `name` key (the file name is the command
  name). A `command` template ships with the others. Subagent and skill
  suggestions gained the keys Claude Code reads today, and a full `claude-`
  model ID or `fable` no longer counts as an odd model. A skill whose
  `description` and `when_to_use` together pass the documented 1,536
  characters is flagged.
- Settings > Terminal and AI holds the same AI CLI picker. The bridge still
  never presses Enter.
- The per-user Windows installer now provides `wired` on the user PATH. The
  command runs through the Electron runtime already shipped with wired-md, so
  installed use requires no separate Node.js or npm. Upgrade, moved-install and
  uninstall handling preserve unrelated PATH entries and preexisting entries.
- Focused packaged CLI checks cover PATH ownership transitions and a real
  `win-unpacked` command smoke with Unicode paths, cold open, list, focus, new
  and expected errors.
- Find in the current note (`Ctrl+F`) and replace (`Ctrl+H`), with match counts,
  next/previous navigation, case and Unicode whole-word filters, and replacement
  of one or all matches. Searches prose, inline formatting, tables and code
  without counting rendered code twice. Replacements support undo and redo.

### Fixed

- `.claude` (agents, commands, skills) and its siblings for other tools
  (`.github`, `.cursor`, `.codex`, `.gemini`) show in the file tree and are
  searched. Every dot folder used to be hidden, which hid most of what this
  editor is for; the others still are.
- Typing in a long note does less work. The status bar, the outline, the
  properties panel, the memory imports and the recovery snapshots now share one
  Markdown reading per change (`modules/text-cache.js`) instead of five, about
  300ms each on a 4,000 line note. Check 33 logs the numbers.
- The app no longer downloads a spellcheck dictionary from Google on first
  launch. The editor never used spellcheck (Vditor turns it off), but
  Chromium's session still fetched `en-US-10-1.bdic`.
- Closing the window with unsaved tabs no longer throws the edits away in
  silence. It asks once, naming the notes: save all (through the normal save,
  so the disk conflict guard still holds and an untitled tab asks for a name),
  don't save, or cancel. With nothing unsaved it closes at once, and a renderer
  that stops answering can never make the window impossible to close.
- The empty state carries the real Lain portrait, a braille drawing the owner
  supplied. Braille has no single width in any stock Windows font (the blank
  cell is narrower than a dense one, which sheared the rows), so
  `modules/portrait.js` decodes each character into its dots and draws them as
  one SVG path in the theme's faint ink.
- The git badges no longer leave a stale `.git/index.lock` behind. Every read
  only git call runs with `GIT_OPTIONAL_LOCKS=0`, so a status killed mid way (a
  timeout, the app quitting) can no longer block the next commit.
- The search, find and diff checks poll for their result instead of sleeping a
  fixed amount, so a busy machine no longer turns a full `npm test` red.
- `wired open` now exits with an error when the editor does not answer, instead
  of printing a path as if the open had succeeded. It also rejects directories.
- Clicking into the document keeps the selected theme's paper color. Vditor's
  focus background token now follows `--bg` instead of its built-in dark gray.
  A real mouse-click regression check covers all five bundled themes.

### Changed

- **Sliding panes are gone; files open in tabs.** Every open file is a tab with
  its name, its unsaved dot and a close button (middle click and `Ctrl+W` close
  too), in a bar that scrolls sideways instead of wrapping. Dragging a tab onto
  the left or right half of the editor splits the view into side by side groups
  (three at most), each with its own tab bar, separated by a resizer whose sizes
  are persisted; dropping a tab on another group's bar moves it, dragging inside
  a bar reorders, and an emptied group collapses into its neighbour. The old
  behavior collapsed whatever no longer fit into 40px vertical spines, which
  turned "open every file in the folder" into a row of unreadable stripes.
- The session layout (groups, tabs and the file in front) is saved and reopened,
  unless a file was passed on the command line.
- The breadcrumb in the editor header now reads left to right as Explorer
  button, folder trail (dim, chevron separated, each segment with its full path
  in the tooltip) and the file itself, with an icon and full ink. Folder and file
  used to look like the same kind of thing.
- The sidebar header shows the parent path of the open folder under its name,
  dimmed and truncated in the middle, with the whole path in the tooltip.
- With no file open the editor is no longer a void with one gray sentence: it
  carries an ASCII portrait of Lain and the hint under it, and the title bar
  carries the product name (read from the app itself) instead of "no file".

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
- Spreadsheet style editing for markdown tables. Tab moves to the next cell and
  grows the table when it runs off the last one, Shift+Tab goes back, Enter
  drops to the row below in the same column. A floating icon toolbar over the
  table (and a palette command for each) adds and deletes rows and columns,
  moves them around, and sets the alignment of a column. Every transform is
  applied to a single table node, and a round trip guard verifies that the rest
  of the document came back byte for byte identical before the change is kept.
- Properties panel v2: a key can be renamed by clicking its label, and a row at
  the bottom of the panel adds a key of any kind (text, number, list, boolean),
  offering the keys of the file's schema first. Order, comments, unknown keys
  and nested maps are preserved exactly; problems stay an inline amber row.
- Templates are managed from inside the app. The picker footer creates, renames,
  deletes and opens a template for editing in a pane, and the palette command
  "manage the template files" opens the picker in that mode. Deleting goes to
  the Recycle Bin, and cancelling any step leaves nothing on disk.
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
- A real Windows installer. `npm run dist` builds an NSIS package with
  electron-builder (`electron-builder.yml`): per user, no elevation, nothing
  under `Program Files`, with `.md` and `.markdown` associated per user and the
  icons in `packaging/`. The ripgrep binary and node-pty ship unpacked beside the
  archive, and the themes, snippets and templates are seeded into `%APPDATA%`
  straight out of `app.asar`.
- `scripts/smoke-installed.mjs`, a smoke test for an INSTALLED build. It drives
  the installed executable from outside over the DevTools protocol (the E2E suite
  lives in `tests/`, which deliberately does not ship) and checks the window, the
  file passed on the command line, the profile seeding, ripgrep answering over
  IPC and node-pty loading its prebuilt binary.

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
- Accessibility on markup the modules build at runtime: a collapsed pane spine
  names the file it holds (tooltip and `aria-label`) and its unsaved dot carries
  the state in words, frontmatter warning rows are announced as a `status`, the
  terminal buttons have labels, and the two sidebar empty states are told apart
  by a class so each gets its own hint instead of sharing an anonymous one.
- The roadmap dropped wikilinks and backlinks for good. The README now carries an
  explicit antifeatures list (no wikilinks or backlinks, no plugins, no database,
  no cloud sync, no graph view): this is an editor for the markdown you write for
  an AI, not an Obsidian clone.

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
- `npm test` no longer leaves the working tree dirty. The two checks that wrote
  PNGs re-encoded them on every run; they are now opt in behind `WIRED_SHOTS=1`.
  The tables fixture check normalized the file's line endings and left it that
  way, so it now keeps the original bytes and writes them back when it is done.
- A user data folder that cannot be created (an invalid `WIRED_USERDATA`, a read
  only drive) surfaced as an unhandled promise rejection and a half working
  window. Startup now reports the error on stderr and exits non zero.

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
