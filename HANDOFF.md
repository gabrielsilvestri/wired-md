# HANDOFF (estado vivo da sessão; sobrescrever, não acumular)

## o que foi feito e decidido (sessão de 12/08/2026)

App nasceu inteiro nesta sessão, do zero (o "fork do Typora" morreu: o código nunca foi aberto; o zip 0.11.18 do Biel era backup de binário). Fases via workflows: base Electron + Vditor IR, customização e terminal, janela frameless 700x840 + fontes de estúdio (Geist, Geist Mono, Mona Sans, Inter, Satoshi, tudo local), shell obsidian (file tree, recentes, barra por ícones), sliding panes reais + palette + ponte claude, sidebar com toolbar/menu de contexto/lixeira + zoom + terminal redimensionável, busca full-text com ripgrep e painel de propriedades de frontmatter. Decisões de UX do Biel aplicadas: engrenagem no rodapé da sidebar, menus por ícone (nunca texto), ponte claude no cabeçalho de cada pane digitando `claude`, `/cd`, path SEM enter (não gasta token).

## estado atual

- Repo: github.com/gabrielsilvestri/wired-md (privado), main, último commit da fase 8 (frontmatter como painel de propriedades). E2E `WIRED_E2E=1 npx electron . exemplos\demo.md` com 46/46 PASS (três rodadas seguidas); smoke `WIRED_SMOKE=1 npm start` verde.
- FASE 8, painel de propriedades: arquivo que começa com bloco YAML `---` ganha um painel editável no topo do pane, com validação por schema (skill, subagent, genérico) em linha de aviso âmbar, nunca popup. Vista DUPLA sincronizada: o bloco continua visível no documento (esconder o nó do Vditor foi descartado, ele é contenteditable e o cursor entraria nele invisível) e os dois lados se atualizam. Parser `yaml` rodando no preload; o bloco só é reescrito quando alguém edita uma propriedade, preservando ordem, comentários, chaves desconhecidas e mapas aninhados. Toggle na palette ("propriedades: mostrar/ocultar") com `frontmatterPanel` no config.json. Fixture versionado: `exemplos\exemplo-skill.md`.
- FASE 7, busca full-text: Ctrl+Shift+F busca por conteúdo em todos os .md da pasta da nota, com ripgrep empacotado (`@vscode/ripgrep`) e fallback em Node puro. Pulo até o trecho é melhor esforço (Vditor IR é WYSIWYG, sem "ir pra linha N").
- Armadilha viva das duas últimas fases: janela coberta por outra faz o Chromium parar de renderizar no Windows (oclusão), o que congela viewport e transições. Os modos de teste sobem com `disable-features=CalculateNativeWinOcclusion`; não remover.
- CLAUDE.md do projeto documenta arquitetura, armadilhas e os hooks de teste. README pra quem chega de fora.
- Branding: `docs\branding\naming.md` (Runa rejeitada pelo Biel; na mesa: Lore, Sutra, Axon, Tomo, Trama, e sobram Navi/Mantra/Koan/Glifo). Ícones: 3 PNG prontos em `docs\branding\icones\` + contact-sheet `icones.html`; 3 ainda estavam renderizando no gpt-image-2, conferir se pousaram.
- `docs\pesquisa-features.md`: pesquisa de features amadas (já implementadas a ponte claude, palette, switcher, busca full-text e frontmatter com schema; fica no radar: templates com variáveis).

## atalho e associação (12/08)

`launcher\wired-md.vbs` roda o app direto do código-fonte, sem janela de console, e aceita um `.md` como argumento. Atalho na área de trabalho (`wired-md.lnk`) aponta pra ele via `wscript.exe`, com ícone `launcher\wired-md.ico` (placeholder feito do `runa-pedra.png`, multi-tamanho de 16 a 256; troca quando o ícone for escolhido). `launcher\wired-md.cmd` é o wrapper que o diálogo "abrir com" do Windows aceita (ele só lista `.exe`, `.bat` e `.cmd`) e é o que ficou como padrão pra `.md`: ProgID `Applications\wired-md.cmd` em `HKCU\Software\Classes`, com `DefaultIcon` (é ele que dá ícone aos arquivos `.md` no Explorer), `FriendlyAppName` e `SupportedTypes`. O ícone dos arquivos é `launcher\wired-md-doc.ico`: folha com canto dobrado, fundo transparente, gradiente teal do app e linhas de texto em `#0D1216`. Ele é DESENHADO, não redimensionado: `launcher\gerar-icone-doc.ps1` (GDI+) redesenha o vetor em cada um dos 10 tamanhos, e abaixo de 24px troca as 4 linhas por 2 barras grossas, senão vira borrão. Pra regerar: rodar o script e remontar o `.ico`. O `wired-md.ico` (glifo runa) segue como ícone do app no atalho. Atenção: o caminho do app está hardcoded no `.vbs`, então renomear a pasta (quando o nome for decidido) exige editar as duas linhas de lá e refazer o atalho.

## próximos passos

1. Biel escolher o nome (aí renomear pasta, repo, package.json, título) e o ícone.
2. Feedback dele usando o app de verdade, principalmente o painel de propriedades em SKILL.md e subagente reais.
3. Candidatas de feature: templates com variáveis pra arquivos de IA, renomear chave e adicionar chave nova pelo painel de propriedades (a v1 só edita valor). Empacotamento (electron-builder, instalador) nunca foi feito: hoje roda só por `npm start` ou pelo launcher.
