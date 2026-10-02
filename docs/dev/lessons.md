# lessons

- 2026-08-12: "sliding panes" means the Obsidian behavior: the active pane wide,
  the inactive ones collapsed into a narrow spine with a vertical title, and a
  click expands with a transition. Fixed columns side by side are not sliding
  panes. Root cause: implementing from the name of the feature without looking at
  the visual reference that was handed over.
- 2026-08-12: the chrome follows Obsidian, not a traditional menu: an action
  lives in an icon with a tooltip (lean title bar), the file controls live in the
  tree toolbar, and the gear sits in the sidebar footer. A text menu in the title
  bar was rejected.
- 2026-08-12: the bridge to claude never sends on its own: it leaves the prompt
  typed with no Enter, because sending spends a token without the owner deciding.
- 2026-08-13: Vditor inline math does not belong in this editor: `$` here is
  money, and "from R$297 to R$ 397" became a formula that ate the whole sentence.
  Root cause: accepting the parser default without asking what syntax the owner
  of the editor actually writes. Turned off in lute with `SetInlineMath(false)`
  right in each pane's `after` hook (there is no equivalent option on the Vditor
  options object; `preview.math.inlineDigit` alone does not hold).
- 2026-08-13: an E2E check that reads state out of `config.json` has to reset that
  state first. The focus mode check assumed `focusMode: false` and broke because
  the owner was using the mode: the label came back as "turn off", Enter turned it
  off, and the next check blew up with index -1 and aborted everything after it.
  Same trap as the zoom check.
- 2026-08-14: a flaky check is usually a fixed sleep pretending to be a wait. The
  terminal check slept a set amount and hoped the shell had answered; it now polls
  the xterm buffer until it grows and settles, with a generous ceiling. Same shape
  the AI bridge already used at runtime.
- 2026-08-14: the E2E reads the user's REAL data folder, so an assertion of the
  form "the list has exactly these four items" is a trap: a template file from an
  older version, or one the owner dropped in, breaks a check that has nothing to
  do with the change. Assert the superset (what must be there), and derive
  positions from the rendered list instead of hardcoding an index.
- 2026-08-14: wikilinks and backlinks are never coming to this editor, and the
  roadmap entry that promised them was itself the bug. Root cause: borrowing a
  competitor's feature list instead of asking what this product is for. A
  `CLAUDE.md` is read by a machine that has never heard of `[[note]]`, so the
  README now carries an explicit antifeatures list next to the roadmap.
- 2026-08-14: the product is English only, top to bottom (UI, identifiers, docs,
  seeded templates, commit messages). Root cause of the earlier mixed state:
  writing the first version in the author's own language and treating the
  translation as cosmetic, when it is the product's audience.
- 2026-08-14: "the CLI" here means the app driven from the terminal, not a
  headless renderer. Root cause of the scope confusion: a CLI usually implies a
  program that does the work itself. This one opens, focuses and creates, and
  changing a note is done by writing the file on disk, because the editor already
  watches the folder.
- 2026-08-14: Chromium rewrites the argv it hands to `second-instance` (it sorts
  its own switches to the front and injects new ones), so a flag and its value
  passed as two arguments arrive split apart with unrelated switches wedged
  between them. Root cause: assuming argv is delivered verbatim. Only a single
  `--switch=value` token survives, which is why the CLI payload is one base64
  blob.
- 2026-08-14: `getComputedStyle` returns a `color-mix()` result as
  `color(srgb r g b)`, not `rgb()`. Root cause: a contrast assertion written
  against the `rgb()` shape it had before the variable used `color-mix`, which
  made a green check go red for a color that had not changed.
- 2026-08-14: Vditor writes inline `padding` on its own elements, and inline
  style loses to nothing short of `!important`. Root cause: assuming a later
  stylesheet always wins. Four of the seven `!important` rules in `styles.css`
  were cargo cult and went away; the two that remain each beat an inline style.
- 2026-08-14: electron-builder runs `@electron/rebuild` by default and tried to
  compile node-pty from source, which fails when the repo path contains a space
  (node-gyp refuses) and when the vendored winpty wants a git checkout to read a
  commit hash. Root cause: rebuilding a dependency that ships N-API prebuilds the
  app already loads unmodified. `npmRebuild: false` is the fix, not a shortcut.
- 2026-08-14: listing a binary in `asarUnpack` does not change what
  `require.resolve` returns. Root cause: assuming the unpack step rewrites module
  resolution. It only decides where the file physically lands, so the code that
  spawns it has to swap the `app.asar` path segment for `app.asar.unpacked`
  itself; in dev the segment is absent and the rewrite is a no-op.
- 2026-08-14: a test that writes a PNG on every run is a dirty working tree on
  every run. Root cause: treating a screenshot as an assertion when it is a
  deliverable. Both shot writing checks are now opt in behind `WIRED_SHOTS=1`,
  and a fixture check that normalized line endings now keeps the original bytes
  and writes them back, because an EOL only diff is invisible in review.
- 2026-08-14: sliding panes died on first real contact: the owner opened every file in the folder and some collapsed into unreadable spines with confusing interaction. Root cause: the pattern was adopted from its looks in another app and never tested against the real "open many files" flow. Product decision: tabs with drag-to-split and user-sized groups replace sliding panes entirely.
- 2026-08-14: a breadcrumb that shows only the folder name fails at orientation: with many files the owner needs to see WHERE on disk the folder lives, and to tell folder segments from the file name at a glance. Root cause: minimalism won over orientation without checking established patterns first.
- 2026-08-14: with tabs, a brand new pane is NOT ready to receive a document: the
  Vditor `after` hook answers a few frames later. Leaving the path in a
  `pendingPath` for that hook to pick up broke every caller that awaited
  `openPath` and then touched the editor (the template flow places a caret right
  after, and it landed nowhere). Root cause: treating "the pane exists" as "the
  editor exists". `openInPane` now waits for `pane.ready`.
- 2026-08-14: closing a tab that is NOT the one on screen must not change which
  tab is on screen. The first version reassigned the group's current tab on
  every close, so a cleanup that closed a background file silently swapped the
  document in front of the user (and in front of the next check, which then read
  the wrong editor).
- 2026-08-14: an assertion about "the active document" that never says which
  document it wants is a check waiting to break: with tabs the previous check no
  longer replaces what is in the editor, so whatever it opened is still in front.
  The focus mode check now puts its fixture in front on purpose.

- 2026-10-02: the README promised "write the file on disk and the editor picks
  it up", but only the tree refreshed: an open note kept the old text and the
  next Ctrl+S overwrote what claude had written. Root cause: the watcher was
  verified for the tree and the promise was written about the documents.
- 2026-10-02: a fixed sleep in a check is a guess about how busy the machine
  is. Search, find and diff all went red in a full run with agents working in
  parallel and green alone. Poll the condition (`until()` in the driver, two
  animation frames for rAF driven UI), with a ceiling.
- 2026-10-02: a plain `git status` writes `.git/index.lock`, and the app killed
  some mid way, leaving locks that blocked the owner's commits. Root cause:
  treating a read as side effect free. Read only git calls run with
  `GIT_OPTIONAL_LOCKS=0`.
- 2026-10-02: braille art is not text you can trust to a font: every stock
  Windows font draws the blank cell narrower than a dense one, so the rows
  sheared. Root cause: assuming a monospace family covers every block it
  falls back on. The portrait is decoded into its dots and drawn as SVG.
- 2026-10-02: "our own save did not trigger a reload" is only a real
  assertion when the app exposes a counter for it. Unchanged editor text cannot
  tell "no reload" from "reloaded with the same text".
- 2026-10-02: a feature that must react to editor content observes the DOM, not
  the Vditor input callback: `setValue` (templates, tests, disk reloads) never
  fires it.
- 2026-10-02: a contrast reading right after a theme switch can catch a color
  mid transition (2.4:1 on a button that settles at 7). Read until two
  consecutive measurements agree.
- 2026-10-02: tuning theme inks to a target ratio by moving only lightness
  keeps the saturation, so cream became mustard. Contrast is not the only
  constraint; every new palette gets looked at in a screenshot.
- 2026-10-02: a check that asserts a placeholder is empty is a promise the next
  feature breaks. Assert what the section holds, not the absence of controls.
- 2026-10-02: `forget()` closes one pane per key. A check that opens several
  notes of a temp folder has to close all of them, or a later tab close puts
  the deleted folder back at the tree root and an unrelated check fails.
