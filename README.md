# wired-md

Editor de markdown para desktop (Windows), estilo Typora: o markdown renderiza inline enquanto você digita, sem painel de preview. Feito para quem escreve markdown para IA (CLAUDE.md, skills, prompts, notas de agente).

![screenshot](docs/screenshot.png)

## Recursos

- Renderização inline (modo IR do Vditor), tema dark por padrão.
- Sidebar estilo Obsidian: árvore de arquivos da pasta da nota aberta (só .md), atualizada sozinha quando algo muda no disco, mais a seção de recentes. Cabeçalho com o nome da raiz e atalho pro Explorer; toolbar com novo .md, nova pasta, ordenação, colapsar tudo e busca que filtra a árvore; menu de contexto (renomear, duplicar, exportar, copiar caminho, excluir pra lixeira). Redimensionável e ocultável.
- Painéis lado a lado (sliding panes de verdade): até 4 arquivos abertos, cada um com salvar e estado sujo próprios. O painel ativo fica largo e os que não cabem viram uma lombada vertical de 40px; clicar nela expande. O layout recalcula sozinho ao redimensionar a janela. Ctrl+clique na árvore ou nos recentes abre ao lado.
- Command palette (Ctrl+Shift+P) com as ações do app e quick switcher (Ctrl+P) com busca fuzzy nos .md da árvore. Ctrl+Enter abre ao lado.
- Ponte claude por nota: o sparkles no cabeçalho de cada painel abre o terminal, sobe o `claude`, faz `/cd` na pasta da nota e digita o caminho do arquivo no prompt, sem enviar: você completa a pergunta. A palette também manda a seleção.
- Zoom do documento: Ctrl+= / Ctrl+- / Ctrl+0 ou Ctrl+scroll, persistido.
- Janela frameless com barra de título própria, só ícones (sem menus de texto), estilo Obsidian.
- Temas custom estilo Obsidian: arquivos .css em `%APPDATA%\wired-md\themes\` que definem só as variáveis de cor. Dois vêm de fábrica: `wired` (dark) e `claro`.
- CSS snippets ligáveis um a um, em `%APPDATA%\wired-md\snippets\`.
- Cor de destaque, fonte do documento, fonte de código e tamanho do texto no painel de configurações (engrenagem). Tudo persiste em `%APPDATA%\wired-md\config.json`.
- Terminal embutido (Ctrl+`), abre no diretório do arquivo atual e redimensiona pelo arrasto da borda superior (altura persistida); botão `claude` digita o comando no shell. Backend node-pty com fallback de pipes.

## Como rodar

```
npm install
npm start
```

Abrir um arquivo direto: `npx electron . caminho\para\arquivo.md`

## Atalhos

- Ctrl+N novo arquivo, Ctrl+O abre, Ctrl+S salva, Ctrl+Shift+S salva como.
- Ctrl+` abre e fecha o terminal.
- Ctrl+P quick switcher (arquivos), Ctrl+Shift+P command palette (ações). Enter abre ou executa, Ctrl+Enter abre ao lado, Esc fecha.
- Ctrl+clique num arquivo da árvore ou dos recentes abre num painel ao lado.
- Ctrl+= aumenta a fonte do documento, Ctrl+- diminui, Ctrl+0 volta ao padrão; Ctrl+scroll sobre o texto também funciona.

## Testes

- `WIRED_SMOKE=1 npm start`: smoke test rápido (terminal, config, temas).
- Teste ponta a ponta, que dirige o app de verdade e imprime PASS/FAIL por fluxo:

```
$env:WIRED_E2E = '1'; npx electron . exemplos\demo.md
```
