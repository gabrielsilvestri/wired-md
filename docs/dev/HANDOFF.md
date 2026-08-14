# HANDOFF (live session state; overwrite it, do not pile up)

## what was done and decided (session of 2026-08-14)

Full modularization pass plus the migration to English. The app behaves exactly
as before; what changed is the shape of the code and the language of everything
the reader sees.

- `src/main.js` (1767 lines) became `src/main/`: `index.js` (window, lifecycle,
  window IPC, the test env gate), `config.js`, `window-state.js` and one file per
  IPC area under `ipc/` (fs, tree, search, customization, terminal). Each IPC file
  registers its own handlers. `package.json` main points at `src/main/index.js`.
- `src/renderer/renderer.js` (2989 lines, one global scope) became
  `src/renderer/app.js` plus 16 ES modules in `src/renderer/modules/`. No bundler:
  Electron loads `file://` modules directly. `app.js` re-exposes on `window` the
  small surface the E2E drives the app through (documented at the bottom of the
  file), including four names the tests assign to, which are accessor properties
  writing back into the owning module.
- The inline test suites (about 970 lines of `executeJavaScript` string blobs
  inside main.js) moved to `tests/`: `tests/e2e/driver.js` holds the plumbing
  (js/key/type/sleep, PASS-FAIL, the config readers, the terminal polling and the
  artifact cleanup helper) and `tests/e2e/checks/NN-name.js` holds the checks, one
  file per feature, run in file name order. `tests/smoke.js` is the smoke run.
  `src/main/index.js` keeps only the env var gate that requires them.
- Third party browser assets are vendored: `scripts/sync-vendor.mjs` copies the
  whole `vditor/dist` (it lazy loads relative to its `cdn` option, so a hand
  picked subset breaks features later), plus xterm and addon-fit, into
  `src/renderer/vendor/` (gitignored), wired as postinstall and prestart.
  `index.html` no longer mentions `node_modules`.
- English migration, product decision: identifiers, comments, UI strings,
  tooltips, dialogs, empty states, warnings, the seeded templates and the example
  notes. `exemplos/` is now `examples/`, the theme `claro` is now `light`, the
  example snippet was renamed, and the template variables are `{{date}}`,
  `{{time}}`, `{{title}}`, `{{folder}}`, `{{cursor}}` and `{{ask:label}}`.
  Old persisted config keeps working: `src/main/config.js` migrates the legacy
  theme name, the legacy snippet file name and the legacy `treeSort: recente`.
- Anti conflict registries for parallel work: `registerPaletteAction` in
  `modules/palette.js`, `registerConfigDefaults` in `modules/state.js` (and per
  area default objects in `src/main/config.js`), and a marked `<link>` slot in
  `index.html` for future `styles/<feature>.css` files.
- The flaky terminal check now polls the xterm buffer until it grows and settles
  instead of sleeping a fixed amount, and every check that reads `config.json`
  resets that state first (the sort order, the terminal height and the properties
  panel toggle were added to the ones that already did).

## current state

- Repo: github.com/gabrielsilvestri/wired-md, branch main. `npm test` is 64/64
  PASS (the count was 59 at phase 11 and grew to 64 with the breadcrumb checks);
  `npm run smoke` green.
- The E2E suite is the definition of "it still works". It writes
  `docs/screenshot.png` and restores every fixture it touches.
- Known noise, all benign: node-pty can print "AttachConsole failed" from the
  conpty agent while tearing down (exit code stays 0), and in dev the Electron CSP
  warning and a disk cache warning show up on boot.

## next steps

1. The product name is still open (renaming the folder means editing the two
   hardcoded lines in the personal `launcher\wired-md.vbs` and rebuilding the
   shortcut; the portable copy in `scripts/windows/` derives its own path).
2. Feature candidates already on the radar: git state visible in the editor,
   spreadsheet style tables, wikilinks and backlinks, renaming and adding keys
   from the properties panel, managing templates from inside the app.
3. Packaging (electron-builder, an installer) has never been done: today the app
   runs from source through `npm start` or the launcher.
