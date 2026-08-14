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
