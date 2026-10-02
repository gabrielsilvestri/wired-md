# HANDOFF (live session state)

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
  opens there; the smoke asserts nothing that it blocks. No `npm run dist` was
  made this session, so the installed build has not met the close guard, the
  welcome or recovery yet: build and run that smoke before a release.
- A recovery snapshot is taken every 2 seconds, so the last 2 seconds of
  typing before a crash can be lost.
- The script that tuned the catalog theme colors was a scratch tool; a retune
  is done by hand against the contrast gate.

## Remaining decisions

- Final product name and icon remain the owner's decision.
- Windows code signing is still pending.
- The personal, gitignored `launcher/wired-md.vbs` still points at the old
  `D:\AI\Lain\wired-md` location.
