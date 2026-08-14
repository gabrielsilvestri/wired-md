# wired-md

[![License: MIT](https://img.shields.io/badge/license-MIT-4fc7bb.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows%2011-0078d4.svg)](#installation)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848f.svg)](https://www.electronjs.org/)
[![Made with Claude](https://img.shields.io/badge/made%20with-Claude-cc9b7a.svg)](https://claude.ai/)

A desktop markdown editor for people who write markdown *for AI*: `CLAUDE.md` files, skills, prompts, agent notes. It renders inline as you type (Typora style, no split preview) and keeps everything as plain `.md` files in your folder, so your notes stay yours.

> The product name is not final yet. Until it is decided, the project uses its repository and package name, `wired-md`.

![Screenshot of wired-md editing a markdown file with sliding panes and the file tree](docs/screenshot.png)

## Why

If you spend your day writing instructions for agents, a general note app gets in the way: it hides your files in a database, fights your `$297` price tags by turning them into math formulas, and has no idea what a `SKILL.md` frontmatter block is supposed to contain. wired-md is built around that exact workflow. It reads and writes ordinary markdown on disk, understands the schemas you actually write, and puts a bridge to `claude` one click away.

## Features

Everything below is implemented and covered by the end to end test suite.

- **Inline WYSIWYG editing (Typora style).** Markdown becomes the document as you type, no side by side preview pane. Powered by Vditor's instant rendering mode.
- **Sliding panes.** Up to four files open side by side (Obsidian / Andy Matuschak style). The active pane stays wide; panes that no longer fit collapse into a 40px vertical spine you click to expand. The layout recomputes on window resize. Ctrl+click a file in the tree or in Recents to open it beside the current one.
- **Obsidian style file tree.** The sidebar shows the folder of the open note (markdown only), refreshes itself when files change on disk, and has a Recents section. Header with the root folder name and a shortcut to Explorer; a toolbar for new file, new folder, sort, collapse all, and a filter box; a right click menu for rename, duplicate, export, copy path, and delete (always to the Recycle Bin, never a hard unlink). Resizable and hideable.
- **Command palette and quick switcher.** Ctrl+Shift+P for actions, Ctrl+P for files, both with fuzzy subsequence search. Enter runs or opens, Ctrl+Enter opens beside, Esc closes.
- **Full text search across the folder.** Ctrl+Shift+F searches file *contents* in every markdown file under the open note's folder, powered by a bundled ripgrep binary with a pure Node fallback. Grouped results with highlighted snippets, keyboard navigable.
- **claude bridge, per note.** A sparkles button in each pane header opens the embedded terminal, brings up `claude`, runs `/cd` into the note's folder, and types the file path into the prompt *without sending it*, so you finish the question. The palette can send the current selection the same way. It never sends on its own: spending a token is your call.
- **Frontmatter as a properties panel.** A file that starts with a YAML `---` block gets an editable properties panel at the top of the pane: text fields for strings and numbers, comma separated fields for lists, checkboxes for booleans, and a read only box for anything the panel cannot represent (which is left untouched in the file). It validates against a schema chosen automatically (`skill`, `subagent`, or generic), flagging a missing `name`, an empty `description`, a likely key typo, or an odd `model`, as a quiet inline warning, never a popup. The YAML block stays visible and the two views stay in sync both ways, preserving key order, comments, and nested maps on round trip.
- **Spreadsheet style table editing.** Tab moves to the next cell and grows the table when it runs off the last one, Shift+Tab goes back, Enter drops to the row below in the same column. A floating icon toolbar over the table (and a palette command for each) adds, deletes, moves and aligns rows and columns, so you never type a pipe. Every transform is applied to a single table node behind a round trip guard that verifies the rest of the document came back byte for byte identical before the change is kept.
- **Git state where the writing happens.** A letter badge (`M`, `A`, `?`, `D`, `R`) on each tree row and in the pane header, plus a read only diff view whose added and removed line colors are derived from the active theme and measured for contrast. Untracked files show as fully added. No staging and no commit UI: the embedded terminal already covers that. Outside a repository, or with no git on PATH, the feature is simply absent.
- **Template management from inside the app.** Create, rename, open for editing and delete templates (Recycle Bin, never a hard unlink) from the same picker that uses them.
- **New file from template, with variables.** Templates are `.md` files seeded into your user folder on first boot (skill, subagent, `CLAUDE.md`, and a dated note ship by default). Variables like `{{date}}`, `{{time}}`, `{{title}}`, `{{folder}}`, `{{cursor}}` (where the caret lands), and `{{ask:label}}` (asked once in an in app dialog) are filled in on creation. Cancel at any step and nothing is written.
- **Focus mode and typewriter mode.** Two independent toggles (F8 and F9). Focus dims every block except the one you are editing; typewriter keeps the current line vertically centered. The dim opacity is *measured*, not guessed, so faded text always clears the 4.5:1 contrast floor in whatever theme is active. Neither mode fights manual scrolling.
- **Themes and CSS snippets, Obsidian style.** Themes are `.css` files that define only the color variables; five ship by default (`wired`, `carbon` and `ash` dark, `light` and `parchment` light), living in `%APPDATA%\wired-md\themes\`. A settings panel edits any theme variable by hand and warns inline when a color you picked leaves the readable contrast band. Snippets are `.css` files you toggle on and off individually, layered over the theme. Accent color, document font, code font, and text size are live controls in the settings panel; everything persists to `%APPDATA%\wired-md\config.json`.
- **Studio typography, offline.** Geist, Geist Mono, Mona Sans, Inter, and Satoshi are bundled locally, no network needed. UI uses Geist, code and terminal use Geist Mono, document body defaults to Mona Sans.
- **Frameless window with a custom title bar.** Icon only chrome (no text menus), custom window controls, a draggable title bar, and window size, position, and maximized state persisted between sessions.
- **Embedded terminal.** Ctrl+` opens a terminal in the current file's directory, resizable by dragging its top edge (height persisted). Backend is node-pty with a pipe based fallback if the native build is unavailable.
- **Dollar sign is money, not math.** Inline math is deliberately off, so `from R$297 to R$ 397` stays readable text instead of turning into an italic formula. Block math (`$$...$$`) still works.
- **Plain files, no lock in.** No database, no proprietary format. Everything is `.md` on disk, readable and editable by anything else.

## Installation

Windows 11, x64. Download the installer (`wired-md Setup <version>.exe`) and run it. It installs **per user**: no administrator prompt, nothing written under `Program Files`, and it registers `.md` and `.markdown` so the app appears in "Open with". Your notes, config, themes, snippets and templates live in `%APPDATA%\wired-md` and survive an uninstall.

### From source

Requirements: Windows 11 and a recent Node.js.

```
git clone https://github.com/gabrielsilvestri/wired-md.git
cd wired-md
npm install
npm start
```

Open a file directly:

```
npx electron . path\to\file.md
```

There is also a portable Windows helper in `scripts/windows/` that creates a desktop shortcut and associates `.md` files with the app. See `scripts/windows/README.md`.

### Building the installer

```
npm run dist
```

electron-builder (config in [`electron-builder.yml`](electron-builder.yml)) produces `dist\wired-md Setup <version>.exe` plus an unpacked build in `dist\win-unpacked`. `scripts/smoke-installed.mjs` drives an *installed* build from outside over the DevTools protocol and checks the things only packaging can break: the window, the file from the command line, the `%APPDATA%` seeding out of `app.asar`, ripgrep running from `app.asar.unpacked`, and node-pty loading its prebuilt binary.

```
node scripts/smoke-installed.mjs "%LOCALAPPDATA%\Programs\wired-md\wired-md.exe"
```

## Keyboard shortcuts

- `Ctrl+N` new file, `Ctrl+O` open, `Ctrl+S` save, `Ctrl+Shift+S` save as.
- `Ctrl+P` quick switcher (files), `Ctrl+Shift+P` command palette (actions), `Ctrl+Shift+F` full text search. Enter opens or runs, `Ctrl+Enter` opens beside, `Esc` closes.
- `Ctrl+click` a file in the tree or Recents to open it in a pane beside the current one.
- `Ctrl+=` / `Ctrl+-` / `Ctrl+0` change document font size; `Ctrl+scroll` over the text also works.
- `Ctrl+\`` toggles the embedded terminal.
- `F8` focus mode, `F9` typewriter mode.

## CLI (experimental)

The editor can be driven from a terminal, so an AI agent working in a shell can put the right note in front of you. This is an experiment: the surface is small on purpose and may change.

```
npm link                                         # puts `wired` on PATH

wired open <file>                                # open a .md (starts the editor if it is not running)
wired focus <file>                               # bring a file that is already open to the front
wired list [--json]                              # the files the editor has open
wired new [--template <name>] [--title <title>]  # create a note from a template and open it
```

There is no daemon, no server and no port: the app is single instance, and a second `wired` invocation hands its argv to the live window and exits. To CHANGE a note, write the file on disk with any tool: the editor watches the folder and picks the change up. The CLI never sends content.

`skills/wired-md/SKILL.md` is a skill file that teaches an AI agent (Claude Code or any CLI agent) to use this.

This works from a **source checkout**, where `npm link` finds the Electron binary in `node_modules`. An installed build has no `node_modules` next to it, so putting `wired` on PATH from the installer is future work; the app records its own executable path in `cli-instance.json` so that wiring has what it needs.

## Roadmap

- **A final name and icon.** The project still ships under its repository name.
- **The CLI in a packaged install.** `wired` works from a source checkout today; putting it on PATH from an installed build is not wired up yet.
- **A theme catalog.** Browsing and installing community themes from inside the app, the way snippets and templates already work from disk.

The full design rationale for the features that shipped lives in [`docs/pesquisa-features.md`](docs/pesquisa-features.md).

## Antifeatures

Things this editor will not grow, so nobody has to ask twice. This is an editor for the markdown you write *for* an AI, not a knowledge base.

- **No wikilinks and no backlinks.** `[[note]]` syntax, a backlinks panel and a graph view belong to Obsidian, which already does them well. A `CLAUDE.md` or a `SKILL.md` is read by a machine that has never heard of `[[note]]`.
- **No plugin system.** Themes and CSS snippets are files on disk and that is the whole extension surface.
- **No database and no proprietary format.** Plain `.md` files in your folders, always.
- **No cloud sync and no account.** Whatever syncs your folder syncs your notes.
- **No graph view.**

## Architecture

Electron main (`src/main/`, one file per IPC area) plus an ES module renderer (`src/renderer/modules/`, no bundler), with the YAML parser running in the preload and a bundled ripgrep binary for search. Third party browser assets are vendored into `src/renderer/vendor/` on install. The full architecture and the known traps are documented in [`CLAUDE.md`](CLAUDE.md).

## Testing

```
npm run smoke   # quick non interactive smoke test
npm test        # full end to end suite (117 checks)
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for what these cover.

## Credits and license

wired-md is released under the [MIT License](LICENSE), copyright 2026 Gabriel Silvestri.

The bundled fonts (Geist, Mona Sans, Inter, Satoshi) are distributed under their own licenses, included in [`src/renderer/fonts/LICENSES`](src/renderer/fonts/LICENSES). Those licenses govern the font files regardless of the MIT license on this project's own code.

Built with [Claude](https://claude.ai/).
