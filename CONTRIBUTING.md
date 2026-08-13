# Contributing to wired-md

Thanks for taking an interest. This is a focused desktop editor for people who
write markdown for AI, and contributions that sharpen that focus are welcome.

## Running from source

Requirements: Windows 11 and a recent Node.js.

```
git clone https://github.com/gabrielsilvestri/wired-md.git
cd wired-md
npm install
npm start
```

Open a specific file: `npx electron . path\to\file.md`

Note on native modules: the embedded terminal uses `node-pty`, which needs
Windows build tools to compile. If that build fails, the app falls back to a
pipe based pseudo terminal, so the editor still runs.

## Testing

Two entry points, both driven by environment variables that the app reads on
boot. Commands are shown for PowerShell.

**Smoke test** (fast, non interactive: logs the terminal backend, xterm
buffer, config, and themes, then exits on its own):

```
$env:WIRED_SMOKE = '1'; npm start
```

**End to end test** (drives the real renderer with real keyboard input:
Ctrl+S, theme and accent changes, snippets, panes, palette, search,
frontmatter, templates, focus and typewriter modes, the claude bridge, and
more; prints PASS/FAIL per flow and exits 0 only when everything is green):

```
$env:WIRED_E2E = '1'; npx electron . exemplos\demo.md
```

The E2E suite is the source of truth for "does it still work". Run it before
opening a pull request, ideally twice in a row (a couple of checks, notably the
terminal shell startup, can be timing sensitive; a re run confirms it is not a
regression). It also writes `docs/screenshot.png` and restores the demo fixture
at the end.

If you add or change behavior, add or update the matching E2E checks in the
same change.

## Commit and branch conventions

Commits in this repo are short, lowercase, imperative, and describe the *effect*
of the change, grouped by the milestone or fix they belong to. Examples from
history:

```
fase 8: frontmatter como painel de propriedades com validação por schema
conserta contraste do tema claro e YAML de template com aspas
```

You may write commit messages in English or Portuguese; keep them short and
descriptive. Do not use an em dash or an en dash anywhere (see Style below).

Branch model:

- Cut a feature branch from `develop`.
- Open a pull request into `develop`.
- Releases are cut on `main` and tagged (for example `v0.1.0`).

A branch serves one task: when it is done, integrate it and delete it.

## Style rules

These are not optional; they are what keeps the project coherent.

- **No em dash and no en dash**, in code, comments, UI text, docs, or commit
  messages. Use parentheses, a comma, a colon, or a separate sentence instead.
  This applies to English as well.
- **Correct Portuguese accents in the UI.** The interface is written in
  Portuguese today, and every word that takes an orthographic accent must carry
  it, including inside HTML, JSON, and CSS.
- **Text contrast between 4.5:1 and 11:1.** The maintainer has astigmatism, so
  contrast that is too high hurts as much as contrast that is too low. Do not
  introduce a text color without measuring it against its background; the
  existing palette already respects this band, and several fixes in history
  exist purely to pull a color back inside it.
- **Plain `.md` files, no database.** State that belongs to the user is a file
  on disk. App state lives under `%APPDATA%\wired-md\`. Do not add a database
  or a proprietary format.
- **Destructive file operations go to the Recycle Bin**, never a hard unlink.

## Language of the codebase

The code and UI are currently in Portuguese (comments, identifiers, and
interface strings). Standardizing to English is open work, not yet done. If you
touch a file, do not mix the two arbitrarily; follow what is already there, and
raise standardization as its own discussion rather than smuggling it into an
unrelated change.

## Architecture

Before a non trivial change, read [`CLAUDE.md`](CLAUDE.md): it documents the
architecture, the phase by phase build history, and the known traps that cost
real debugging time. The developer state notes live in `docs/dev/`.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
