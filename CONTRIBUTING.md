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
npm run smoke
```

**Full test** (checks runner isolation and the packaged CLI helper, then drives
the real renderer with real keyboard input: Ctrl+S, theme and accent changes,
snippets, panes, palette, search, frontmatter, templates, focus and typewriter
modes, the claude bridge, and more; exits 0 only when everything is green):

```
npm test
```

Use `npm run test:cli` to run the runner and packaged CLI checks without
starting Electron.

`npm test` ends with `npm run test:crash`: it launches the app from the
checkout over the DevTools protocol, leaves a note with unsaved edits, kills the
whole process tree, relaunches with the same profile and expects the edits back.
The E2E suite cannot do that from inside the process it would have to kill.

The E2E suite is the source of truth for "does it still work". Run it before
opening a pull request, ideally twice in a row (a couple of checks, notably the
terminal shell startup, can be timing sensitive; a re run confirms it is not a
regression). The runner creates and removes an isolated temporary user data
folder by default. Set `WIRED_USERDATA` explicitly to retain a profile for
debugging; the runner never removes an explicit profile. Screenshot writing is
opt in with `WIRED_SHOTS=1`, including regeneration of `docs/screenshot.png`.
The suite restores the demo fixture at the end.

The suite lives in `tests/e2e/`: `driver.js` holds the plumbing (js/key/sleep,
PASS-FAIL, the terminal polling helpers) and each `tests/e2e/checks/NN-name.js`
owns one feature's checks, running in file name order.

If you add or change behavior, add or update the matching E2E checks in the
same change. A check that reads state out of `config.json` must reset that
state first so it does not depend on state left by an earlier check.

## Commit and branch conventions

Commits in this repo are short, lowercase, imperative, and describe the *effect*
of the change, grouped by the milestone or fix they belong to. Examples from
history:

```
frontmatter as a properties panel with schema validation
fix the light theme contrast and the quoted YAML in templates
```

Commit messages are English, short and descriptive. Do not use an em dash or an
en dash anywhere (see Style below).

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
- **English only.** The product, the UI strings, the identifiers, the comments
  and the docs are all English. That is a product decision, not a preference:
  this is an open source editor and a mixed language codebase costs every reader
  something.
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

English, everywhere: identifiers, comments, UI strings, template files, example
notes and docs. There is no second language to keep in sync.

## Architecture

Before a non trivial change, read [`CLAUDE.md`](CLAUDE.md): it documents the
current architecture and the known traps that cost real debugging time. The
developer state notes live in `docs/dev/`.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
