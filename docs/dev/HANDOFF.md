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

Also on main: the owner's braille Lain portrait in the empty state
(`modules/portrait.js`), polling instead of fixed sleeps in the search, find
and diff checks, and `GIT_OPTIONAL_LOCKS=0` on every read only git call.

## Verification

Run `npm test` twice without `WIRED_ONLY`; it isolates the profile itself. Run
`node scripts/measure-contrast.mjs` for the standalone gate (it now covers
`themes/catalog`). The packaged CLI smoke is unchanged (see the previous notes
in `CHANGELOG.md`).

## Known gaps, none blocking

- A plain click on a link does nothing; Ctrl+click follows it, by design.
- Profiles that predate the `onboarded` key (the owner's included) see the
  welcome once after this update. Esc or skip dismisses it for good.
- `scripts/smoke-installed.mjs` cannot set the test gate, so the welcome auto
  opens there; the smoke asserts nothing that it blocks.
- The script that tuned the catalog theme colors was a scratch tool; a retune
  is done by hand against the contrast gate.

## Remaining decisions

- Final product name and icon remain the owner's decision.
- Windows code signing is still pending.
- The personal, gitignored `launcher/wired-md.vbs` still points at the old
  `D:\AI\Lain\wired-md` location.
