# HANDOFF do wired-md

Estado que muda. O que é estável mora no `CLAUDE.md`; o que já foi entregue mora no `CHANGELOG.md`.

## o batismo está em aberto

`wired-md` é nome PROVISÓRIO. `Runa` foi rejeitado. Estavam na mesa em 14/08/2026: Lore, Sutra, Axon, Tomo, Trama, Navi, Mantra, Koan, Glifo. Ele não escolheu nenhum.

Quando escolher, o nome tem uma fonte só: `app.getName()` (o `name` do `package.json`), que o preload entrega ao renderer como `window.wired.appName`. Nunca digitar o nome dentro do renderer. Hoje o `package.json` está em `wired-md`, versão `0.1.0`.

## o que mais está aberto

1. **Escolha do ícone.** Material em `docs/branding/`.
2. **Empacotamento com instalador.** O `npm run dist` já gera o instalador do Windows em `dist/`; falta fechar a distribuição de verdade.
3. **A CLI não está no PATH.** O `bin/wired.js` acha o Electron e tem o que lançar, mas nada o registra no PATH ainda.

## registrado em 20/08/2026

Este arquivo nasceu na reforma da memória, recolhendo o que estava no cofre de auto-memory. As pendências acima são de 14 e 15/08/2026 e não foram reconferidas contra o repo: confirmar com o Biel antes de tratar qualquer uma como viva.
