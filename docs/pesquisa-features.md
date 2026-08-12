# Pesquisa de features: o que o mercado ama e odeia nos editores markdown

Pesquisa feita em 12/08/2026 para orientar o roadmap do wired-md. Fontes: listas de plugins mais baixados do Obsidian (obsidianstats.com), issue tracker do Typora, comparativos recentes de editores (2025 e 2026) e discussões de comunidade. A premissa: os plugins mais baixados do Obsidian revelam exatamente o que o core não entrega e todo mundo quer.

## 1. As 10 features mais amadas

### 1. Command palette (paleta de comandos)
O que é: um atalho único (Ctrl+P) que abre uma busca fuzzy sobre todos os comandos do app.
Onde brilha: Obsidian e VS Code. É o padrão mental de todo dev: ninguém decora menu, todo mundo digita. Plugins como Commander existem só pra deixar a paleta ainda mais central.
Evidência: https://dev.to/proflead/stop-missing-out-on-these-obsidian-features-4ipm
Esforço no wired-md: baixo. Um overlay com fuzzy search sobre um registro de comandos que o app já tem internamente.

### 2. Busca global no vault (quick switcher + busca full-text)
O que é: abrir qualquer arquivo da pasta por nome (fuzzy) e buscar texto em todos os arquivos, com resultados navegáveis.
Onde brilha: Obsidian (quick switcher é citado como a feature que ninguém larga), iA Writer, Zettlr. Quem edita CLAUDE.md espalhado em vários repositórios vive procurando "onde eu escrevi aquela regra".
Evidência: https://nimbalyst.com/blog/the-complete-guide-to-markdown-editors/
Esforço no wired-md: médio. Fuzzy por nome é baixo; full-text rápido pede indexação (ripgrep embutido resolve barato em Electron).

### 3. Templates com variáveis (estilo Templater)
O que é: criar arquivo novo a partir de template com variáveis (data, nome, prompts) e trechos reutilizáveis.
Onde brilha: Templater é o segundo plugin mais baixado do Obsidian (4,7 milhões de downloads). Pra quem escreve skills e agentes, o esqueleto de um SKILL.md ou de um subagent é sempre o mesmo: template resolve.
Evidência: https://www.obsidianstats.com/most-downloaded
Esforço no wired-md: baixo a médio. Pasta de templates + substituição de variáveis simples é baixo; scripting completo é alto e desnecessário.

### 4. Integração Git visível no editor
O que é: status do arquivo (modificado, staged), commit e diff sem sair do editor.
Onde brilha: plugin Git do Obsidian tem quase 3 milhões de downloads, mesmo o público do Obsidian sendo menos dev que o do wired-md. CLAUDE.md e skills vivem em repositório: o público-alvo inteiro versiona esses arquivos.
Evidência: https://www.obsidianstats.com/most-downloaded
Esforço no wired-md: médio. Badge de status e diff colorido na sidebar é médio; o terminal embutido já cobre o resto.

### 5. Edição de tabelas estilo planilha
O que é: Tab navega células, colunas se alinham sozinhas, ordenar e adicionar coluna sem digitar pipe.
Onde brilha: Advanced Tables tem 3,1 milhões de downloads no Obsidian; Typora é elogiado exatamente por editar tabela como gente. Tabela markdown na mão é uma das piores experiências universais.
Evidência: https://www.obsidianstats.com/most-downloaded
Esforço no wired-md: médio. Num editor WYSIWYG a base já existe; o trabalho é o modelo de célula e os comandos de linha/coluna.

### 6. Foco e typewriter mode
O que é: modo que esmaece parágrafos fora do atual e mantém a linha de edição no centro vertical da tela.
Onde brilha: é A feature do iA Writer e um dos motivos mais citados pra escolher Typora. Custa pouco e define identidade de "editor pra escrever".
Evidência: https://nimbalyst.com/blog/the-complete-guide-to-markdown-editors/
Esforço no wired-md: baixo. CSS (opacity por bloco) e um scroll ancorado.

### 7. Wikilinks e backlinks entre arquivos
O que é: `[[arquivo]]` com autocomplete cria link entre notas; painel mostra quem aponta pro arquivo atual.
Onde brilha: é o coração do Obsidian, do Bear e do Zettlr. Pro público IA tem tradução direta: skills referenciam `references/*.md`, CLAUDE.md aponta pra outros arquivos; ver o grafo de dependência de um workspace de agente é útil de verdade.
Evidência: https://richardstevenhack.substack.com/p/solve-your-life-management-problems
Esforço no wired-md: alto. Autocomplete de link é médio, mas backlinks pedem índice do vault e rename que atualiza referências.

### 8. IA embutida com contexto dos arquivos
O que é: chat ou comando de IA que enxerga os arquivos da pasta e edita ou responde com esse contexto.
Onde brilha: Claudian (Claude dentro do Obsidian) já passou de 1,7 milhão de downloads mesmo sendo recente, o sinal de demanda mais forte da lista. O wired-md já tem terminal com claude, o que é meio caminho.
Evidência: https://www.obsidianstats.com/most-downloaded
Esforço no wired-md: baixo a médio. O terminal já invoca o claude; o degrau seguinte é açúcar (comando "mande este arquivo pro claude", saída de volta no editor).

### 9. Snippets e temas com controle fino (estilo Style Settings)
O que é: além de tema custom, um painel que expõe variáveis do tema (cores, fontes, densidade) como controles, sem editar CSS.
Onde brilha: Style Settings e Minimal Theme Settings somam mais de 4 milhões de downloads no Obsidian: as pessoas querem personalizar sem escrever CSS. O wired-md já tem temas .css e snippets com toggle; o painel de variáveis é a evolução natural.
Evidência: https://www.obsidianstats.com/most-downloaded
Esforço no wired-md: baixo. Ler CSS custom properties do tema ativo e gerar controles.

### 10. Preview e lint de frontmatter (properties)
O que é: renderizar o YAML frontmatter como painel de propriedades editável em vez de bloco de texto cru, com validação.
Onde brilha: Obsidian core adotou (Properties) e Pretty Properties foi um dos plugins novos mais baixados de 2025. Pro público IA é ainda mais relevante: SKILL.md e subagents dependem de frontmatter correto (`name`, `description`, `tools`), e um typo ali quebra o agente silenciosamente.
Evidência: https://www.obsidianstats.com/posts/2025-12-04-wrapped-2025
Esforço no wired-md: médio. Parser YAML + UI de chaves/valores; validação por schema (skill, agent, genérico) é o diferencial e é barata.

Menções honrosas que não entraram no top 10: Kanban em markdown (2,4M downloads, mas fora do público), Excalidraw (1º em downloads, mas é um app dentro do app: esforço altíssimo), Calendar e daily notes (público de journaling, não de agentes).

## 2. As 5 dores mais reclamadas (o que evitar)

1. Lentidão por acúmulo de plugins e workspace pesado. Relatos de Obsidian levando 30 segundos pra abrir, caindo pra 5 com plugins desligados. Lição: features nativas e enxutas em vez de arquitetura de plugin aberta; startup instantâneo é feature. (https://obsidian.rocks/fixing-slow-startup-on-obsidian-mobile/, https://tfthacker.substack.com/p/improve-obsidian-startup-time-on-older-devices-with-the-faststart-script-70a6c590309f)
2. Excesso de configuração e decision fatigue. "Obsidian is too complicated" é um gênero inteiro de post: o usuário passa mais tempo configurando que escrevendo, e vira um "franken-app" frágil. Lição: defaults fortes, opções poucas. (https://productivematters.substack.com/p/obsidian-is-too-complicated, https://dev.to/charudatta10/why-obsidian-falls-short-as-a-note-taking-tool-3ef2)
3. Fechamento e falta de extensão no Typora. A issue mais antiga e votada do Typora pede plugins e nunca foi atendida; sem isso, cada falta vira beco sem saída. Lição: não precisa de ecossistema de plugin, mas precisa de válvulas de escape (CSS, temas, comandos externos), que o wired-md já tem. (https://github.com/typora/typora-issues/issues/162)
4. Abandono de projeto open source. MarkText, o "Typora grátis", está sem release desde 2022 e é citado em todo comparativo como aviso: bug não será corrigido. Lição: escopo pequeno que um mantenedor sustenta vale mais que feature list grande. (https://portalzine.de/the-best-open-source-markdown-editors-for-writing-and-beyond/)
5. Lock-in de plataforma e de formato. Bear e iA Writer perdem usuários por serem só Apple; apps que guardam nota em banco próprio em vez de .md puro na pasta são penalizados em toda comparação. Lição: arquivos .md planos na pasta do usuário, sem banco, sem formato próprio, sempre. (https://unmarkdown.com/blog/best-markdown-editors-2026)

## 3. Recomendação priorizada para o wired-md

Filtro aplicado: o usuário do wired-md escreve CLAUDE.md, SKILL.md, prompts e notas de agente; vive em repositório git; já tem terminal com claude dentro do app. Journaling, Zettelkasten e gestão de tarefas ficam de fora.

1. Command palette com quick switcher (fuzzy de comandos e de arquivos da pasta): é a feature de maior amor por menor esforço, e o público dev já tem o Ctrl+P no músculo.
2. Frontmatter como painel de propriedades com validação por schema (skill, subagent, genérico): nenhum concorrente valida frontmatter de arquivo de agente, e é exatamente onde o público do wired-md se machuca hoje.
3. Templates com variáveis pra arquivos de IA (CLAUDE.md, SKILL.md, agent .md prontos pra preencher): transforma o app de "editor que abre .md" em "ferramenta de quem constrói agentes", com esforço baixo.
4. Busca full-text na pasta via ripgrep embutido: quem mantém instruções espalhadas em vários arquivos precisa achar "onde escrevi essa regra" em um atalho.
5. Ponte editor-claude por cima do terminal existente (comando que manda o arquivo ou a seleção pro claude e traz a resposta): o sucesso do Claudian no Obsidian mostra que é a demanda que mais cresce, e o wired-md já tem a infraestrutura pela metade.

Antifeatures assumidas de propósito: sem sistema de plugins, sem banco de dados próprio, sem sync na nuvem, sem grafo. O que o mercado pune (lentidão, complexidade, lock-in) é o que o wired-md ganha por não ter.
