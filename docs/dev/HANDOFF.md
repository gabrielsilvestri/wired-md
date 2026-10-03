# HANDOFF (live session state)

## Night round (2026-10-02, two hours, autonomous)

- **Icon**: the cable drawn as a hash (`docs/branding/icones/cabo-hash-source.png`,
  made in ChatGPT Images on the web). `python scripts/build-icons.py` writes
  `packaging/*.ico`, `src/renderer/icon.png` (the window icon, new in
  `src/main/index.js`) and the site icons. The Runa files stay as history.
  The Codex CLI route (`gen.sh` in Image Gen 2) returned "done" without
  calling the image tool on 0.157 and 0.159.2, so the web app was used.
- **Landing**: `site/` is self contained (Geist in `site/fonts`, screenshots
  in `site/assets`), published at https://gabrielsilvestri.github.io/wired-md/
  by `.github/workflows/pages.yml` (Pages build type: workflow). Repo homepage,
  description and topics point at it. Screenshots come from check 95 with
  `WIRED_SHOTS=1`; the share card `site/assets/og.png` was rendered once from
  an HTML card (see `site/README.md`).
- **Fixes**: link text takes the theme accent (check 28); closing one dirty tab
  asks save, don't save or cancel (`confirmClosePane`, check 38).

## Current development (2026-10-02)

The owner asked for six hours of autonomous development. Five features landed,
each built in its own worktree and merged into main with its E2E check:

- **Disk sync** (`modules/disk-sync.js`, `ipc/filewatch.js`, check 26): open
  notes follow their file on disk; dirty tabs get a reload or keep mine row;
  Ctrl+S never writes over a newer disk version; gone files keep their tab.
- **Outline and status bar** (`modules/outline.js`, `modules/statusbar.js`,
  check 27): heading outline in the sidebar, word, character and token
  estimate counts.
- **Links and images** (`modules/links.js`, `ipc/assets.js`, check 28):
  Ctrl+click links, navigation guard, relative images, paste and drop.
- **Theme gallery and reading settings** (`modules/gallery.js`,
  `modules/reading.js`, `themes/catalog/`, check 74).
- **First run welcome** (`modules/onboarding.js`, `ipc/onboarding.js`, check
  75) and the AI CLI picker in Settings > Terminal and AI.

Then, in the main session:

- **Close guard** (`modules/close-guard.js`, check 31): closing the window with
  unsaved tabs asks save all, don't save or cancel.
- **Crash recovery** (`modules/recovery.js`, `ipc/recovery.js`, check 32):
  snapshots of unsaved tabs come back at the next launch.
- **Editor right click menu** (`modules/editor-menu.js`, `ipc/edit.js`, check
  30).
- **CLAUDE.md imports** (`modules/memory-imports.js`, `ipc/imports.js`, check
  29): the context the `@path` imports add, Ctrl+click to open one.
- **What changed on disk**: Compare in the conflict row and a palette action,
  diffing raw disk text (`modules/line-diff.js`).
- A slash command frontmatter schema and template, setext headings and section
  token sizes in the outline, a gone file marks its tab unsaved, review fixes.
- **One shared Markdown reading per change** (`modules/text-cache.js`, check
  33 on a 4,000 line note: 5 readings per keystroke before, 2 after).
- **`.claude` and the other agent folders** show in the tree and are searched
  (check 34).
- **A real crash test** (`scripts/test-crash-recovery.mjs`, last step of
  `npm test`): it caught a Hunspell dictionary download from Google on first
  launch, now off.
- The landing page (`site/`) and the README tell the new features and are
  honest that no release is published yet.

A third round, after the owner said to keep going:

- Tool names in frontmatter checked against the documented Claude Code list
  (check 16); the session keeps each tab's scroll (check 35).
- The AI bridge cds the shell before starting the CLI instead of typing
  Claude Code's `/cd` into any CLI (check 92).
- Errors are toasts, never `alert()` (`modules/toast.js`, check 36).
- Export as HTML or PDF (`modules/export-note.js`, check 37), also from the
  right click menu and from a terminal (`wired export`, check 93), which
  renders the file on disk and never overwrites without `--force`.
- Outline reachable from the keyboard, settings headings spaced, the gallery
  marks Appearance when opened from the palette, `.claude/worktrees` hidden.

Also on main: the owner's braille Lain portrait in the empty state
(`modules/portrait.js`), polling instead of fixed sleeps in the search, find
and diff checks, and `GIT_OPTIONAL_LOCKS=0` on every read only git call.

## Verification

Run `npm test` twice without `WIRED_ONLY`; it isolates the profile itself and
ends with the real crash test. Run `node scripts/measure-contrast.mjs` for the
standalone gate (it now covers `themes/catalog`). The packaged CLI smoke is
unchanged (see the previous notes in `CHANGELOG.md`).

## Known gaps, none blocking

- A plain click on a link does nothing; Ctrl+click follows it, by design.
- Profiles that predate the `onboarded` key (the owner's included) see the
  welcome once after this update. Esc or skip dismisses it for good.
- `scripts/smoke-installed.mjs` cannot set the test gate, so the welcome auto
  opens there, and the smoke now asserts exactly that. `npm run dist` was run
  at the end of the session; `smoke-installed.mjs` against
  `dist\win-unpacked\wired-md.exe` passed 10 of 10 (catalog from app.asar,
  welcome, recovery, imports included) and `smoke-packaged-cli.ps1` passed,
  again on `b3247af` after the third round (310 checks, twice in a row), and
  last on `fbc3329`: 312 checks twice in a row, smoke, dist, installed smoke
  10 of 10 (launch to a rendered note about 0.75 to 1.2 s), packaged CLI smoke.
  Never edit `src/` while `npm run dist` runs: the asar packs files at offsets
  read earlier, and a file that changes size mid build corrupts its
  neighbours (a `window-state.js` holding the tail of `tree.js`).
- A recovery snapshot is taken every 2 seconds, so the last 2 seconds of
  typing before a crash can be lost.
- The script that tuned the catalog theme colors was a scratch tool; a retune
  is done by hand against the contrast gate.

## Remaining decisions

- Final product name and icon remain the owner's decision.
- Windows code signing is still pending.
- The personal, gitignored `launcher/wired-md.vbs` still points at the old
  `D:\AI\Lain\wired-md` location.
