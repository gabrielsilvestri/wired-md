# HANDOFF (estado vivo da sessão; sobrescrever, não acumular)

## o que foi feito e decidido (sessão de 12/08/2026)

App nasceu inteiro nesta sessão, do zero (o "fork do Typora" morreu: o código nunca foi aberto; o zip 0.11.18 do Biel era backup de binário). Seis fases via workflows: base Electron + Vditor IR, customização e terminal, janela frameless 700x840 + fontes de estúdio (Geist, Geist Mono, Mona Sans, Inter, Satoshi, tudo local), shell obsidian (file tree, recentes, barra por ícones), sliding panes reais + palette + ponte claude, sidebar com toolbar/menu de contexto/lixeira + zoom + terminal redimensionável. Decisões de UX do Biel aplicadas: engrenagem no rodapé da sidebar, menus por ícone (nunca texto), ponte claude no cabeçalho de cada pane digitando `claude`, `/cd`, path SEM enter (não gasta token).

## estado atual

- Repo: github.com/gabrielsilvestri/wired-md (privado), main, último commit da fase 6c. E2E `WIRED_E2E=1 npx electron . exemplos\demo.md` com 35/35 PASS; smoke `WIRED_SMOKE=1`.
- CLAUDE.md do projeto documenta arquitetura, armadilhas e os hooks de teste. README pra quem chega de fora.
- Branding: `docs\branding\naming.md` (Runa rejeitada pelo Biel; novas ideias na mesa: Lore (favorita da lain), Sutra, Axon, Tomo, Trama, e sobram Navi/Mantra/Koan/Glifo do top 5). Ícones: 3 PNG prontos em `docs\branding\icones\` + contact-sheet `icones.html`; 3 ainda estavam renderizando no gpt-image-2, conferir se pousaram.
- `docs\pesquisa-features.md`: pesquisa de features amadas (implementada a ponte claude, palette e switcher; ficam no radar: validação de frontmatter por schema, templates com variáveis, busca full-text via ripgrep).

## próximos passos

1. Biel escolher o nome (aí renomear pasta, repo, package.json, título) e o ícone.
2. Feedback dele usando o app de verdade.
3. Candidatas de feature: frontmatter com validação por schema pra SKILL.md/agents, templates, ripgrep. Empacotamento (electron-builder, instalador) nunca foi feito: hoje roda só por `npm start`.
