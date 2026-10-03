# wired-md handoff

Current technical state and verification instructions live in
[`docs/dev/HANDOFF.md`](docs/dev/HANDOFF.md). Stable project rules are in
`CLAUDE.md`; delivered changes are in `CHANGELOG.md`.

## Latest work (2026-10-02)

- Open notes follow their file on disk, with an inline conflict row when the tab has unsaved edits.
- Outline, status bar with a token estimate, working links, relative images, image paste.
- Theme gallery (ten catalog themes), line height and text width settings, first run welcome with the AI CLI picker.
- The owner's braille Lain portrait in the empty state.
- Closing with unsaved tabs asks first; unsaved edits survive a crash (`npm test` ends with a real kill and relaunch).
- CLAUDE.md `@path` imports counted in the status bar and opened with Ctrl+click; a right click menu in the text; "what changed on disk" as a diff.
- One shared Markdown reading per change (long notes type faster); `.claude` and the other agent folders show in the tree and in search.
- The landing page and README tell all of this, and say no release is published yet.

## Owner decisions still open

`wired-md` is provisional. `Runa` was rejected. The alternatives recorded on
2026-08-14 were Lore, Sutra, Axon, Tomo, Trama, Navi, Mantra, Koan and Glifo;
no final choice is recorded. Branding materials are in `docs/branding/`.

The Windows installer builds through `npm run dist`. Final distribution and code signing remain separate work.
