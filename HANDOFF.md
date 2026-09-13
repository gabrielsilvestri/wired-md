# wired-md handoff

Current technical state and verification instructions live in
[`docs/dev/HANDOFF.md`](docs/dev/HANDOFF.md). Stable project rules are in
`CLAUDE.md`; delivered changes are in `CHANGELOG.md`.

## Latest work (2026-09-11)

- The Windows installer now adds `wired` to the user PATH and removes only its owned entry on uninstall.
- The installed CLI runs through the bundled Electron runtime, without Node.js or npm on the user's PATH.
- The final NSIS build and a real `win-unpacked` CLI smoke passed. No installer was installed globally during validation.

## Owner decisions still open

`wired-md` is provisional. `Runa` was rejected. The alternatives recorded on
2026-08-14 were Lore, Sutra, Axon, Tomo, Trama, Navi, Mantra, Koan and Glifo;
no final choice is recorded. Branding materials are in `docs/branding/`.

The Windows installer builds through `npm run dist`. Final distribution and code signing remain separate work.
