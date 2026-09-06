# wired-md handoff

Current technical state and verification instructions live in
[`docs/dev/HANDOFF.md`](docs/dev/HANDOFF.md). Stable project rules are in
`CLAUDE.md`; delivered changes are in `CHANGELOG.md`.

## Latest work (2026-09-04)

- Fixed the background changing to gray when clicking into the editor.
- Added Ctrl+F find and Ctrl+H replace in the active note, including undo/redo.
- Added real Electron regression checks for the five themes and editing flows.

## Owner decisions still open

`wired-md` is provisional. `Runa` was rejected. The alternatives recorded on
2026-08-14 were Lore, Sutra, Axon, Tomo, Trama, Navi, Mantra, Koan and Glifo;
no final choice is recorded. Branding materials are in `docs/branding/`.

The Windows installer already builds through `npm run dist`. Packaged CLI PATH
integration, final distribution and code signing remain separate work.
