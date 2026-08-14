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
- **New file from template, with variables.** Templates are `.md` files seeded into your user folder on first boot (skill, subagent, `CLAUDE.md`, and a dated note ship by default). Variables like `{{date}}`, `{{time}}`, `{{title}}`, `{{folder}}`, `{{cursor}}` (where the caret lands), and `{{ask:label}}` (asked once in an in app dialog) are filled in on creation. Cancel at any step and nothing is written.
- **Focus mode and typewriter mode.** Two independent toggles (F8 and F9). Focus dims every block except the one you are editing; typewriter keeps the current line vertically centered. The dim opacity is *measured*, not guessed, so faded text always clears the 4.5:1 contrast floor in whatever theme is active. Neither mode fights manual scrolling.
- **Themes and CSS snippets, Obsidian style.** Themes are `.css` files that define only the color variables (`wired` dark and `light` ship by default), living in `%APPDATA%\wired-md\themes\`. Snippets are `.css` files you toggle on and off individually, layered over the theme. Accent color, document font, code font, and text size are live controls in the settings panel; everything persists to `%APPDATA%\wired-md\config.json`.
- **Studio typography, offline.** Geist, Geist Mono, Mona Sans, Inter, and Satoshi are bundled locally, no network needed. UI uses Geist, code and terminal use Geist Mono, document body defaults to Mona Sans.
- **Frameless window with a custom title bar.** Icon only chrome (no text menus), custom window controls, a draggable title bar, and window size, position, and maximized state persisted between sessions.
- **Embedded terminal.** Ctrl+` opens a terminal in the current file's directory, resizable by dragging its top edge (height persisted). Backend is node-pty with a pipe based fallback if the native build is unavailable.
- **Dollar sign is money, not math.** Inline math is deliberately off, so `from R$297 to R$ 397` stays readable text instead of turning into an italic formula. Block math (`$$...$$`) still works.
- **Plain files, no lock in.** No database, no proprietary format. Everything is `.md` on disk, readable and editable by anything else.

## Installation

wired-md currently runs from source. A packaged installer does not exist yet (it is on the roadmap).

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

## Keyboard shortcuts

- `Ctrl+N` new file, `Ctrl+O` open, `Ctrl+S` save, `Ctrl+Shift+S` save as.
- `Ctrl+P` quick switcher (files), `Ctrl+Shift+P` command palette (actions), `Ctrl+Shift+F` full text search. Enter opens or runs, `Ctrl+Enter` opens beside, `Esc` closes.
- `Ctrl+click` a file in the tree or Recents to open it in a pane beside the current one.
- `Ctrl+=` / `Ctrl+-` / `Ctrl+0` change document font size; `Ctrl+scroll` over the text also works.
- `Ctrl+\`` toggles the embedded terminal.
- `F8` focus mode, `F9` typewriter mode.

## Roadmap

- **Packaging.** A real installer (electron-builder), so the app runs without cloning the source.
- **Wikilinks and backlinks.** `[[note]]` links and a backlinks panel.
- **Spreadsheet style table editing.** Tab to move between cells, auto aligned columns, add and reorder rows and columns without typing pipes.
- **Theme variable panel.** Edit theme color variables from inside the app instead of by hand.
- **More from the properties panel.** Rename a key and add a new key (v1 edits values only), and manage templates from within the app.

The full design rationale for these lives in [`docs/pesquisa-features.md`](docs/pesquisa-features.md).

## Architecture

Electron main (`src/main/`, one file per IPC area) plus an ES module renderer (`src/renderer/modules/`, no bundler), with the YAML parser running in the preload and a bundled ripgrep binary for search. Third party browser assets are vendored into `src/renderer/vendor/` on install. The full architecture and the known traps are documented in [`CLAUDE.md`](CLAUDE.md).

## Testing

```
npm run smoke   # quick non interactive smoke test
npm test        # full end to end suite (64 checks)
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for what these cover.

## Credits and license

wired-md is released under the [MIT License](LICENSE), copyright 2026 Gabriel Silvestri.

The bundled fonts (Geist, Mona Sans, Inter, Satoshi) are distributed under their own licenses, included in [`src/renderer/fonts/LICENSES`](src/renderer/fonts/LICENSES). Those licenses govern the font files regardless of the MIT license on this project's own code.

Built with [Claude](https://claude.ai/).
