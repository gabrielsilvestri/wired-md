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

## Armadilhas

- Windows: node-pty precisa de build tools; se a build falhar, o fallback é um pseudo-terminal via child_process (spawn powershell, stdin/stdout pipe) com xterm.js só como render.
- Acentuação pt-BR correta em toda UI. Nunca usar em dash ou en dash em texto.
- Contraste: teto de 11:1 e piso de 4.5:1 para texto (astigmatismo do usuário). A paleta do dashboard já respeita isso; não inventar cor nova sem medir.
