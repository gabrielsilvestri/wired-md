# HANDOFF (live session state; overwrite it, do not pile up)

## where the project stands (2026-08-14)

The app is feature complete for its own definition of the job, it has a real
Windows installer, and the suite is green twice in a row with a clean working
tree. What is left is a naming decision, not engineering.

## what the five agent pass delivered

- **Modular codebase.** `src/main/` (CommonJS, one file per IPC area) and
  `src/renderer/modules/` (ES modules, one per feature, no bundler). Third party
  browser assets are vendored into `src/renderer/vendor/` by
  `scripts/sync-vendor.mjs`, gitignored and regenerated on install and start.
- **136 check end to end suite** in `tests/e2e/checks/NN-name.js`, plus a smoke
  run, plus `scripts/measure-contrast.mjs` as a standalone contrast gate.
- **Features.** Spreadsheet style table editing, properties panel v2 (rename a
  key, add a key), template management from inside the app, git badges and a read
  only diff view, five themes with an in app theme variable editor, and `wired`,
  the experimental CLI that drives the live window from a terminal.
- **A Windows installer.** `npm run dist` builds an NSIS package with
  electron-builder: per user, no elevation, `.md` and `.markdown` associated per
  user, ripgrep and node-pty unpacked beside the archive, and the seed folders
  read straight out of `app.asar`. `scripts/smoke-installed.mjs` drives an
  installed build from outside over the DevTools protocol and is green.
- **Suite hygiene.** `npm test` no longer touches the working tree: the three
  screenshot writing checks are opt in behind `WIRED_SHOTS=1`, and the tables
  fixture is restored byte for byte including its line endings.
- **Accessibility on dynamic markup.** Tabs (tablist, aria-selected, a close
  button that names the file), unsaved dots, frontmatter warning rows, terminal
  buttons and the two sidebar empty states.

## how to verify it in one sitting

```
$env:WIRED_USERDATA="$env:TEMP\wired-check"; npm test    # 117 PASS, twice
git status --porcelain                                   # must be empty
node scripts/measure-contrast.mjs                        # green
npm start                                                # boots
npm run dist                                             # dist\wired-md Setup <version>.exe
node scripts/smoke-installed.mjs "<installed exe>"       # 6 PASS
```

## next build, and it is PRIORITY

1. **Find and replace in the open note (Ctrl+F).** The app has no in-document
   find at all. `src/renderer/app.js:96` binds Ctrl+Shift+F, which opens the
   full text search ACROSS files (`modules/search.js`); Ctrl+F does nothing, and
   Vditor does not supply one. Scope: a find bar over the active pane, next and
   previous match, match count, case and whole word toggles, Escape to close,
   then replace and replace all. Watch the traps: global shortcuts listen in the
   CAPTURE phase, the bar has to follow `.pane.active` and survive zero tabs, and
   highlight colors need the 4.5:1 to 11:1 measurement like any other text color.
   Add an E2E check in `tests/e2e/checks/` in the same commit.

## pending, and it is the owner's call

1. **The final name and the icon.** Everything ships under `wired-md`, the
   repository and package name. Deciding the name means, in this order: rename
   the folder, the GitHub repo, `name` in `package.json`, `productName` and
   `appId` in `electron-builder.yml`, the file association names, the window
   title, the README and the badge links; then fix the two hardcoded absolute
   paths in the personal `launcher\wired-md.vbs` and rebuild the shortcut. The
   portable copy in `scripts/windows/` derives its own path and needs nothing.
   The icons currently in `packaging/` are placeholders from `launcher/`.
2. **The CLI in a packaged install.** `wired` works from a source checkout
   (`npm link`), because `bin/wired.js` finds Electron in `node_modules`. An
   installed app has none. The instance marker now records `exe`
   (`process.execPath`), which is what a packaged CLI would launch, but nothing
   puts a shim on PATH yet.
3. **A theme catalog.** Browsing and installing themes from inside the app,
   instead of dropping a `.css` into the themes folder by hand.
4. **Code signing.** The installer is unsigned, so SmartScreen warns on any
   machine that is not the owner's.
