# wired-md

Editor de markdown para desktop (Windows), estilo Typora: o markdown renderiza inline enquanto você digita, sem painel de preview. Feito para quem escreve markdown para IA (CLAUDE.md, skills, prompts, notas de agente).

![screenshot](docs/screenshot.png)

## Recursos

- Renderização inline (modo IR do Vditor), tema dark por padrão.
- Sidebar com os .md da pasta do arquivo aberto.
- Temas custom estilo Obsidian: arquivos .css em `%APPDATA%\wired-md\themes\` que definem só as variáveis de cor. Dois vêm de fábrica: `wired` (dark) e `claro`.
- CSS snippets ligáveis um a um, em `%APPDATA%\wired-md\snippets\`.
- Cor de destaque, fonte do documento, fonte de código e tamanho do texto no painel de configurações (engrenagem). Tudo persiste em `%APPDATA%\wired-md\config.json`.
- Terminal embutido (Ctrl+`), abre no diretório do arquivo atual; botão `claude` digita o comando no shell. Backend node-pty com fallback de pipes.

## Como rodar

```
npm install
npm start
```

Abrir um arquivo direto: `npx electron . caminho\para\arquivo.md`

## Atalhos

- Ctrl+O abre arquivo, Ctrl+S salva, Ctrl+` abre e fecha o terminal.

## Testes

- `WIRED_SMOKE=1 npm start`: smoke test rápido (terminal, config, temas).
- Teste ponta a ponta, que dirige o app de verdade e imprime PASS/FAIL por fluxo:

```
$env:WIRED_E2E = '1'; npx electron . exemplos\demo.md
```
