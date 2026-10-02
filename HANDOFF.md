# wired-md handoff

Current technical state and verification instructions live in
[`docs/dev/HANDOFF.md`](docs/dev/HANDOFF.md). Stable project rules are in
`CLAUDE.md`; delivered changes are in `CHANGELOG.md`.

## Latest work (2026-10-02)

- Open notes follow their file on disk, with an inline conflict row when the tab has unsaved edits.
- Outline, status bar with a token estimate, working links, relative images, image paste.
- Theme gallery (ten catalog themes), line height and text width settings, first run welcome with the AI CLI picker.
- The owner's braille Lain portrait in the empty state.

## Owner decisions still open

`wired-md` is provisional. `Runa` was rejected. The alternatives recorded on
2026-08-14 were Lore, Sutra, Axon, Tomo, Trama, Navi, Mantra, Koan and Glifo;
no final choice is recorded. Branding materials are in `docs/branding/`.

The Windows installer builds through `npm run dist`. Final distribution and code signing remain separate work.
