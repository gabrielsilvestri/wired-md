# HANDOFF (live session state)

## Current development (2026-09-04)

The owner asked to continue development, then prioritized the document's gray
background when clicking to type and the missing Ctrl+F editing action.

- Fixed the focus background: Vditor's `--textarea-background-color` now uses
  the active theme's `--bg`. Before the fix, real clicks changed all five themes
  to `#2f363d`. The regression check exercises those clicks in each theme.
- Added in-note find (`Ctrl+F`) and replace (`Ctrl+H`) in `modules/find.js`, with
  match count, navigation, case and Unicode whole-word options, one/all
  replacement, undo/redo, active pane tracking and a safe zero-tab state.
- Highlighting uses CSS Custom Highlights, not editable DOM wrappers. Search
  includes prose, inline formatting, tables and code source once, excluding
  Markdown markers and link destinations. Replacement text is literal.
- Added `24-editor-focus.js` and `25-note-find.js` to the E2E suite. Profiles
  used during development are isolated through `WIRED_USERDATA`.

## Verification

Run `npm test` twice with an isolated `WIRED_USERDATA`, without `WIRED_ONLY`.
There are 175 checks with the five bundled themes. Run
`node scripts/measure-contrast.mjs` for the standalone theme contrast gate.
The find check also measures both highlight colors and the bar in each theme.

## Remaining decisions

- Final product name and icon remain the owner's decision.
- The CLI works from source; packaged installation still has no PATH shim.
- In-app theme catalog and Windows code signing are still pending.
- The personal, gitignored `launcher/wired-md.vbs` still points at the old
  `D:\AI\Lain\wired-md` location. The portable launcher under `scripts/windows/`
  derives its path; the personal launcher should do the same if used again.

No dependency versions were changed. No release, installation, or publication
was performed as part of this development pass.
