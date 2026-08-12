# wired-md

Editor de markdown desktop em Electron, estilo Typora (WYSIWYG live, sem split view), feito para quem escreve markdown para IA (CLAUDE.md, skills, prompts, notas de agente).

## Objetivo

- Editar .md com renderização inline ao estilo Typora (o markdown "vira" o documento enquanto digita).
- Visual idêntico ao dashboard da lain (`.lain/dashboard/index.html`): fundo #101216, tinta #bcc2c9, accent teal #4fc7bb, JetBrains Mono, bordas sussurro.
- Customização estilo Obsidian: temas custom (arquivos de tema), troca de fonte, cor de accent, CSS snippets que o usuário liga e desliga.
- Terminal simples embutido (painel inferior) para invocar `claude` no diretório do arquivo aberto.

## O que mede sucesso

Abrir um .md real, editar com preview inline, trocar tema/accent/fonte ao vivo, ligar um snippet de CSS, abrir o terminal e rodar `claude`. Tudo sem crash no Windows 11.

## Como rodar

```
npm install
npm start
```

## Customização (fase 2, implementada)

- Temas: arquivos .css em `%APPDATA%\wired-md\themes\` que definem só as CSS variables (`:root { --bg: ...; }`). Os padrões `wired` (dark) e `claro` são copiados de `themes/` do repo no primeiro boot. Seletor no painel de configurações (engrenagem).
- Snippets: .css em `%APPDATA%\wired-md\snippets\`, ligados um a um por toggle no painel; aplicados por cima do tema.
- Accent, fonte do documento, fonte de código e tamanho do texto: overrides no painel; accent deriva soft/ink/dim por mistura com branco/preto no renderer.
- Tudo persiste em `%APPDATA%\wired-md\config.json` (theme, accent, fontBody, fontCode, fontSize, snippets) e é aplicado no boot.
- Terminal embutido: Ctrl+` (painel inferior, xterm.js). Backend node-pty rodando; fallback de pipes existe em `startPipeShell` no main.js caso o binário quebre. Botão claude digita o comando no shell.
- Smoke test sem interação: `WIRED_SMOKE=1 npm start` (loga backend do terminal, buffer do xterm, config e temas, e sai sozinho).
- Teste ponta a ponta (fase 3): `WIRED_E2E=1 npx electron . exemplos/demo.md` dirige o renderer de verdade (teclado real via sendInputEvent, Ctrl+S, troca de tema, accent, snippet, terminal com dir) e imprime PASS/FAIL por fluxo; exit code 0 só com tudo verde. Salva screenshot em docs/screenshot.png e restaura o demo.md ao final.
- Atalhos globais do renderer ficam em listener de keydown na FASE DE CAPTURA: o Vditor consome keydown dentro do editor, então sem captura o Ctrl+S digitando no texto não chega ao handler.

## Janela custom e tipografia (fase 4, implementada)

- Janela frameless (`frame: false`, `Menu.setApplicationMenu(null)`): barra de título desenhada pelo app em `#titlebar` (região de arrasto via `-webkit-app-region: drag`, no-drag nos controles). Menus custom em HTML (Arquivo: novo/abrir/salvar/salvar como; Exibir: sidebar/terminal/configurações), título do arquivo no centro (bolinha âmbar quando sujo) e controles minimizar/maximizar-restaurar/fechar no canto direito (fechar fica com fundo `--red` no hover). Duplo clique na barra maximiza; o ícone restaurar troca via IPC `window:maximized`.
- Tamanho padrão: bloquinho vertical 700x840 (estilo Notepad), minWidth 420. Tamanho, posição e estado maximizado persistem em `%APPDATA%\wired-md\window-state.json` (salvos com debounce em resize/move e no close, restaurados no boot).
- Fontes empacotadas em `src/renderer/fonts/` (offline, licenças em `fonts/LICENSES/`): Geist e Geist Mono (npm `geist`, OFL), Mona Sans (release do github/mona-sans, OFL), Inter e Inter Display (release do rsms/inter, OFL), Satoshi (Fontshare, FFL). Registradas em `fonts/fonts.css`. UI usa Geist, código e terminal Geist Mono, corpo do documento Mona Sans por padrão. O painel de configurações lista as empacotadas primeiro (`BUNDLED_FONTS` no renderer).
- Capricho: `-webkit-font-smoothing: antialiased`, tabular nums no terminal e nos campos numéricos, letter-spacing positivo em labels pequenos, line-height do documento 1.65.
- O E2E cobre a fase 4: frameless sem menu nativo, barra arrastável, controles respondendo (maximizar/restaurar), menu abrindo e fechando e window-state.json persistido (15 checks no total).

## Shell Obsidian (fase 5a, implementada)

- Sidebar com FILE TREE de verdade: árvore da pasta da nota aberta (IPC `dir:tree` no main, recursiva, só .md/.markdown e pastas que contenham algum; ignora ocultas, node_modules, .git). Subpastas nascem fechadas, chevron gira ao abrir, estado de expansão preservado entre refreshes (`expandedDirs` no renderer). Item ativo com borda esquerda accent. Ícones SVG inline estilo lucide, traço 1.5.
- `fs.watch` recursivo na pasta da nota (IPC `dir:watch`, debounce de 350ms no main, evento `dir:changed`): arquivo novo gerado pelo claude aparece sozinho na árvore.
- Sidebar flexível: resizer de arrasto na borda direita (180 a 480px), botão de ocultar/mostrar na barra. `sidebarWidth` e `sidebarVisible` persistem no config.json.
- Seção RECENTES abaixo da árvore (ícone de relógio): últimos 12 arquivos abertos, persistidos em `recentFiles` no config.json.
- Barra de título só de ícones: sem menus de texto Arquivo/Exibir. Botões (SVG lucide, tooltip pt-BR via title): sidebar, novo, abrir, salvar, terminal, configurações. Atalhos de teclado inalterados. Drag region, título central e controles de janela mantidos.
- Terminal nasce no diretório da nota ativa (já era assim) e ganhou o botão cd no painel: manda `cd "<pasta da nota>"` pro shell aberto sem reiniciar.
- E2E da fase 5a: 19 checks (árvore com ativo, pasta nova via fs.watch + expandir, recentes, resize com clamp, ocultar/mostrar persistido, botões de ícone, botão cd). O match do `dir` no terminal ignora quebras de linha, porque o xterm quebra nomes conforme a largura da sidebar.

## Panes, palette e ponte claude (fase 5b, implementada)

- SLIDING PANES: até 4 arquivos lado a lado (estilo Obsidian/Andy Matuschak). Cada pane é uma instância própria do Vditor com path e dirty próprios; `currentPath`, `vditor` e `dirty` viraram getters do pane ativo em `window` (compat com o resto do código e com o E2E). Ctrl+clique na árvore ou nos recentes (ou o botão "abrir ao lado" na barra) abre num pane novo à direita; clique simples abre no pane ativo. Pane com 640px fixos e scroll horizontal do conjunto (`#panes`); com um pane só, ele ocupa tudo (classe `single`). Cabeçalho fino por pane (nome, bolinha âmbar de sujo, botão fechar); pane ativo com linha accent no cabeçalho. Arquivo já aberto em outro pane não duplica: ativa o pane dele. Ctrl+S salva o pane ativo (mousedown no pane ativa ele).
- COMMAND PALETTE (Ctrl+Shift+P) e QUICK SWITCHER (Ctrl+P): overlay central com busca fuzzy por subsequência (`fuzzyScore` no renderer, bônus pra começo de palavra e trechos contíguos). Palette lista as ações do app (`PALETTE_ACTIONS`); switcher busca nos .md da árvore atual (`treeFiles`, achatada no refreshSidebar). Enter executa/abre, Ctrl+Enter abre ao lado, setas navegam, Esc fecha.
- PONTE CLAUDE: "mandar arquivo pro claude" e "mandar seleção pro claude" (botões de ícone na barra + ações na palette). Abrem o terminal, esperam o shell subir, fazem cd pra pasta da nota e digitam `claude '<prompt>'` (aspas simples do PowerShell, com aspa simples dobrada via `psQuote`; path do arquivo entre aspas duplas dentro do prompt; seleção compactada a 2000 chars). A seleção é capturada quando a palette abre (`lastSelection`), porque o foco no input derruba a seleção do editor.
- E2E da fase 5b: 24 checks no total (panes abrem/fecham, palette filtra e executa, switcher acha e abre, botões da ponte claude).

## Auditoria integrada (fase 5c, implementada)

- E2E 24/24 verde estável (duas rodadas seguidas) e smoke verde. Teste exploratório extra (10 fluxos cruzados que o E2E não cobre) rodado via hook temporário no main.js, depois removido: dois panes sujos com Ctrl+S em cada, tema com panes abertos, resize da sidebar com terminal aberto, recentes com vários arquivos, fs.watch com arquivo criado por fora, fechar o último pane, switcher com Ctrl+Enter.
- Fix da auditoria: `openPath` de arquivo já aberto em outro pane agora faz `pushRecent(p)` ao ativar o pane, senão a ordem dos recentes mente sobre o último usado.
- Ruídos conhecidos e benignos: no fim do E2E o node-pty pode cuspir "AttachConsole failed" do conpty_console_list_agent no teardown (exit code segue 0); no boot em dev aparecem o warning de CSP do Electron (some empacotado) e "Failed to read DnsHosts" (hosts customizado da máquina). Nenhum console.error do app.

## Armadilhas

- Windows: node-pty precisa de build tools; se a build falhar, o fallback é um pseudo-terminal via child_process (spawn powershell, stdin/stdout pipe) com xterm.js só como render.
- Acentuação pt-BR correta em toda UI. Nunca usar em dash ou en dash em texto.
- Contraste: teto de 11:1 e piso de 4.5:1 para texto (astigmatismo do usuário). A paleta do dashboard já respeita isso; não inventar cor nova sem medir.
