# HANDOFF (estado vivo da sessão; sobrescrever, não acumular)

## o que foi feito e decidido (sessão de 12/08/2026)

App nasceu inteiro nesta sessão, do zero (o "fork do Typora" morreu: o código nunca foi aberto; o zip 0.11.18 do Biel era backup de binário). Seis fases via workflows: base Electron + Vditor IR, customização e terminal, janela frameless 700x840 + fontes de estúdio (Geist, Geist Mono, Mona Sans, Inter, Satoshi, tudo local), shell obsidian (file tree, recentes, barra por ícones), sliding panes reais + palette + ponte claude, sidebar com toolbar/menu de contexto/lixeira + zoom + terminal redimensionável. Decisões de UX do Biel aplicadas: engrenagem no rodapé da sidebar, menus por ícone (nunca texto), ponte claude no cabeçalho de cada pane digitando `claude`, `/cd`, path SEM enter (não gasta token).

## estado atual

- Repo: github.com/gabrielsilvestri/wired-md (privado), main, último commit da fase 7 (busca full-text). E2E `WIRED_E2E=1 npx electron . exemplos\demo.md` com 40/40 PASS (duas rodadas seguidas, e mais uma com `WIRED_SEARCH_ENGINE=node` pra provar o fallback); smoke `WIRED_SMOKE=1` verde.
- FASE 7, busca full-text: Ctrl+Shift+F busca por conteúdo em todos os .md da pasta da nota, com ripgrep empacotado (`@vscode/ripgrep`, ~5,2 MB no node_modules) e fallback em Node puro. Overlay na família visual da palette, resultados agrupados por arquivo, Enter abre, Ctrl+Enter abre ao lado. Pulo até o trecho é melhor esforço (Vditor IR é WYSIWYG, sem "ir pra linha N"). Detalhes e armadilhas no CLAUDE.md.
- Achado dessa fase: janela coberta por outra faz o Chromium parar de renderizar no Windows (oclusão), o que congela viewport e transições e derrubava 3 checks antigos. Os modos de teste agora sobem com `disable-features=CalculateNativeWinOcclusion`.
- CLAUDE.md do projeto documenta arquitetura, armadilhas e os hooks de teste. README pra quem chega de fora.
- Branding: `docs\branding\naming.md` (Runa rejeitada pelo Biel; novas ideias na mesa: Lore (favorita da lain), Sutra, Axon, Tomo, Trama, e sobram Navi/Mantra/Koan/Glifo do top 5). Ícones: 3 PNG prontos em `docs\branding\icones\` + contact-sheet `icones.html`; 3 ainda estavam renderizando no gpt-image-2, conferir se pousaram.
- `docs\pesquisa-features.md`: pesquisa de features amadas (implementada a ponte claude, palette e switcher; ficam no radar: validação de frontmatter por schema, templates com variáveis, busca full-text via ripgrep).

## atalho e associação (12/08)

`launcher\wired-md.vbs` roda o app direto do código-fonte, sem janela de console, e aceita um `.md` como argumento. Atalho na área de trabalho (`wired-md.lnk`) aponta pra ele via `wscript.exe`, com ícone `launcher\wired-md.ico` (placeholder feito do `runa-pedra.png`, multi-tamanho de 16 a 256; troca quando o ícone for escolhido). `launcher\wired-md.cmd` é o wrapper que o diálogo "abrir com" do Windows aceita (ele só lista `.exe`, `.bat` e `.cmd`) e é o que ficou como padrão pra `.md`: ProgID `Applications\wired-md.cmd` em `HKCU\Software\Classes`, com `DefaultIcon` (é ele que dá ícone aos arquivos `.md` no Explorer), `FriendlyAppName` e `SupportedTypes`. O ícone dos arquivos é `launcher\wired-md-doc.ico`: folha com canto dobrado, fundo transparente, gradiente teal do app e linhas de texto em `#0D1216`. Ele é DESENHADO, não redimensionado: `launcher\gerar-icone-doc.ps1` (GDI+) redesenha o vetor em cada um dos 10 tamanhos, e abaixo de 24px troca as 4 linhas por 2 barras grossas, senão vira borrão. Pra regerar: rodar o script e remontar o `.ico`. O `wired-md.ico` (glifo runa) segue como ícone do app no atalho. O ProgID `wiredmd.markdown` também está registrado, como fallback. Atenção: o caminho do app está hardcoded no `.vbs`, então renomear a pasta (quando o nome for decidido) exige editar as duas linhas de lá e refazer o atalho.

## próximos passos

1. Biel escolher o nome (aí renomear pasta, repo, package.json, título) e o ícone.
2. Feedback dele usando o app de verdade.
3. Candidatas de feature: frontmatter com validação por schema pra SKILL.md/agents, templates (a busca full-text saiu do radar, está pronta). Empacotamento (electron-builder, instalador) nunca foi feito: hoje roda só por `npm start`.
