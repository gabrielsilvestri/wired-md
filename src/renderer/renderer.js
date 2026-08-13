// Renderer do wired-md: Vditor em modo IR (instant rendering) em sliding panes
// (até 4 lado a lado, estilo Obsidian), sidebar de arquivos, command palette e
// quick switcher, painel de configurações (tema, accent, fontes, snippets),
// terminal embutido com xterm.js e ponte pro claude.

let config = {
  theme: 'wired',
  accent: null,
  fontBody: '',
  fontCode: '',
  fontSize: 15,
  snippets: [],
  sidebarWidth: 240,
  sidebarVisible: true,
  recentFiles: [],
  treeSort: 'az',
  terminalHeight: 260,
  frontmatterPanel: true,
  focusMode: false,
  typewriterMode: false
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const titlebarTitle = document.getElementById('titlebar-title');
const sidebar = document.getElementById('sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const fileTreeEl = document.getElementById('file-tree');
const recentListEl = document.getElementById('recent-list');
const recentSection = document.getElementById('recent-section');
const sidebarEmpty = document.getElementById('sidebar-empty');
const sidebarRootName = document.getElementById('sidebar-root-name');
const treeSearchWrap = document.getElementById('tree-search-wrap');
const treeSearchInput = document.getElementById('tree-search');
const ctxMenuEl = document.getElementById('ctx-menu');
const themeStyle = document.getElementById('theme-style');
const customStyle = document.getElementById('custom-style');
const panesEl = document.getElementById('panes');

function baseName(p) {
  return p.split(/[\\/]/).pop();
}

function dirName(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}

// ---------------------------------------------------------------------------
// sliding panes: cada pane tem seu próprio Vditor, path e estado sujo.
// Máximo de 4 panes lado a lado; o conjunto rola na horizontal.
// ---------------------------------------------------------------------------

const MAX_PANES = 4;
const panes = []; // { id, el, titleEl, path, dirty, vditor, ready, pendingPath }
let activePaneId = null;
let paneSeq = 0;

function activePane() {
  return panes.find((p) => p.id === activePaneId) || panes[0] || null;
}

// Compatibilidade com o restante do código (e com o E2E): currentPath, vditor
// e dirty continuam existindo como leituras do pane ativo.
Object.defineProperty(window, 'currentPath', { get: () => (activePane() ? activePane().path : null) });
Object.defineProperty(window, 'vditor', { get: () => (activePane() ? activePane().vditor : null) });
Object.defineProperty(window, 'dirty', { get: () => !!(activePane() && activePane().dirty) });

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(size, paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

const ICON_CHEVRON = ['m9 18 6-6-6-6'];
const ICON_FOLDER = ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'];
const ICON_FILE = ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M15 2v5h5'];
const ICON_X = ['M18 6 6 18', 'm6 6 12 12'];
const ICON_SPARKLES = ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z', 'M20 3v4', 'M22 5h-4'];

// Math inline ($...$) é ruído puro num editor de markdown pra IA: "R$ 300" e
// "de R$ 297 a R$ 397" viram fórmula e a frase inteira quebra. O Lute (parser
// do Vditor) aceita desligar isso em runtime, e não existe opção equivalente
// no objeto de opções do Vditor, por isso o toque direto na instância assim
// que ela nasce. Bloco de fórmula ($$...$$) continua funcionando.
function disableInlineMath(vd) {
  const lute = vd && vd.vditor && vd.vditor.lute;
  if (lute && typeof lute.SetInlineMath === 'function') lute.SetInlineMath(false);
}

function vditorOptions(pane) {
  return {
    mode: 'ir',
    cdn: '../../node_modules/vditor',
    height: '100%',
    theme: 'dark',
    lang: 'pt_BR',
    toolbar: [],
    toolbarConfig: { hide: true },
    cache: { enable: false },
    preview: {
      theme: { current: 'dark', path: '../../node_modules/vditor/dist/css/content-theme' },
      hljs: { style: 'native', lineNumber: false },
      markdown: { toc: true, mark: true },
      // Dígito logo depois do marcador de abertura seria math ("$300$").
      // Aqui isso é dinheiro, então fica desligado (o desligamento de verdade
      // é o SetInlineMath abaixo; este é o cinto de segurança).
      math: { inlineDigit: false }
    },
    placeholder: 'abra um arquivo .md ou comece a escrever...',
    input: () => {
      setPaneDirty(pane, true);
      // Edição no documento refaz o painel de propriedades (debounce), porque o
      // frontmatter pode ter sido mexido na mão dentro do editor.
      scheduleFmRefresh(pane);
      // Digitar move o caret: modo foco remarca o bloco e o typewriter recentra.
      caretMoved();
    },
    after: () => {
      pane.ready = true;
      disableInlineMath(pane.vditor);
      if (pane.pendingPath) {
        const p = pane.pendingPath;
        pane.pendingPath = null;
        openInPane(pane, p);
      }
    }
  };
}

// Ordem de uso dos panes (mais recente primeiro): decide quem fica aberto
// quando não cabe todo mundo confortável na janela.
let paneMru = [];

function touchMru(id) {
  paneMru = [id, ...paneMru.filter((x) => x !== id)];
}

// Sliding panes de verdade: o pane ativo (e os que couberem confortáveis)
// ganham a largura flexível; os excedentes viram lombada estreita com o
// título na vertical. Recalculado ao ativar, abrir, fechar e no resize.
const SPINE_W = 40;
const PANE_COMFORT = 480; // largura mínima confortável de um pane aberto

function relayoutPanes() {
  if (panes.length === 0) return;
  const total = panesEl.clientWidth || window.innerWidth || 800;
  // Quantos panes abertos cabem: nOpen*COMFORT + (resto)*SPINE <= total.
  let nOpen = Math.floor((total - panes.length * SPINE_W) / (PANE_COMFORT - SPINE_W));
  nOpen = Math.max(1, Math.min(panes.length, nOpen));
  const openSet = new Set();
  for (const id of paneMru) {
    if (openSet.size >= nOpen) break;
    if (panes.some((p) => p.id === id)) openSet.add(id);
  }
  for (const p of panes) {
    if (openSet.size >= nOpen) break;
    openSet.add(p.id);
  }
  for (const p of panes) p.el.classList.toggle('collapsed', !openSet.has(p.id));
}

function updatePanesLayout() {
  panesEl.classList.toggle('single', panes.length === 1);
  relayoutPanes();
}

// Resize da janela (maximizar, restaurar, arrastar borda) recalcula o layout
// na hora; o Vditor reflui sozinho porque as larguras são flexíveis.
let panesResizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(panesResizeTimer);
  panesResizeTimer = setTimeout(relayoutPanes, 50);
}).observe(panesEl);

function paneTitleText(pane) {
  return pane.path ? baseName(pane.path) : 'sem título';
}

function updatePaneHeader(pane) {
  pane.titleEl.textContent = (pane.dirty ? '● ' : '') + paneTitleText(pane);
  pane.titleEl.title = pane.path || '';
  pane.titleEl.classList.toggle('dirty', pane.dirty);
  // A lombada mostra o mesmo título (na vertical) e a bolinha âmbar de sujo.
  pane.spineTitleEl.textContent = paneTitleText(pane);
  pane.spineTitleEl.title = pane.path || '';
  pane.spineDotEl.classList.toggle('on', pane.dirty);
}

function createPane() {
  if (panes.length >= MAX_PANES) return null;
  const id = ++paneSeq;
  const el = document.createElement('div');
  el.className = 'pane';

  const header = document.createElement('div');
  header.className = 'pane-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'pane-title';
  // Ponte claude por nota: o sparkles no cabeçalho age nesta nota.
  const claudeBtn = document.createElement('button');
  claudeBtn.className = 'pane-claude';
  claudeBtn.title = 'Mandar esta nota pro claude';
  claudeBtn.setAttribute('aria-label', 'Mandar esta nota pro claude');
  claudeBtn.appendChild(svgIcon(13, ICON_SPARKLES));
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-close';
  closeBtn.title = 'Fechar painel';
  closeBtn.setAttribute('aria-label', 'Fechar painel');
  closeBtn.appendChild(svgIcon(12, ICON_X));
  header.appendChild(titleEl);
  header.appendChild(claudeBtn);
  header.appendChild(closeBtn);

  // Lombada do pane encolhido: X no topo, bolinha de sujo e título vertical.
  const spine = document.createElement('div');
  spine.className = 'pane-spine';
  spine.title = 'Expandir este painel';
  const spineClose = document.createElement('button');
  spineClose.className = 'pane-close spine-close';
  spineClose.title = 'Fechar painel';
  spineClose.setAttribute('aria-label', 'Fechar painel');
  spineClose.appendChild(svgIcon(12, ICON_X));
  const spineDotEl = document.createElement('span');
  spineDotEl.className = 'spine-dot';
  const spineTitleEl = document.createElement('span');
  spineTitleEl.className = 'spine-title';
  spine.appendChild(spineClose);
  spine.appendChild(spineDotEl);
  spine.appendChild(spineTitleEl);

  // Painel de propriedades (frontmatter YAML): entre o cabeçalho e o editor,
  // por pane, porque cada pane é um arquivo diferente.
  const fmEl = document.createElement('div');
  fmEl.className = 'fm-panel hidden';

  const edEl = document.createElement('div');
  edEl.className = 'pane-editor';
  edEl.id = 'pane-ed-' + id;

  el.appendChild(spine);
  el.appendChild(header);
  el.appendChild(fmEl);
  el.appendChild(edEl);
  panesEl.appendChild(el);

  const pane = { id, el, titleEl, spineTitleEl, spineDotEl, fmEl, fmTimer: null, path: null, dirty: false, vditor: null, ready: false, pendingPath: null };
  pane.vditor = new Vditor(edEl.id, vditorOptions(pane));

  el.addEventListener('mousedown', () => setActivePane(pane));
  spine.addEventListener('click', () => setActivePane(pane));
  claudeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sendPaneToClaude(pane);
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePane(pane);
  });
  spineClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closePane(pane);
  });

  panes.push(pane);
  touchMru(id);
  updatePanesLayout();
  updatePaneHeader(pane);
  return pane;
}

function setActivePane(pane) {
  if (!pane) return;
  touchMru(pane.id);
  if (activePaneId === pane.id) {
    relayoutPanes();
    return;
  }
  activePaneId = pane.id;
  for (const p of panes) p.el.classList.toggle('active', p.id === pane.id);
  relayoutPanes();
  // Foco e typewriter valem só no pane ativo: trocar de pane move os dois.
  applyFocusMode();
  applyTypewriterMode();
  updateChrome();
  refreshSidebar();
}

function closePane(pane) {
  if (pane.dirty && !confirm('Há alterações não salvas neste painel. Fechar mesmo assim?')) return;
  const idx = panes.indexOf(pane);
  if (idx === -1) return;
  try {
    pane.vditor.destroy();
  } catch {}
  pane.el.remove();
  panes.splice(idx, 1);
  paneMru = paneMru.filter((x) => x !== pane.id);
  if (panes.length === 0) {
    const novo = createPane();
    activePaneId = novo.id;
    novo.el.classList.add('active');
  } else if (activePaneId === pane.id) {
    const next = panes[Math.min(idx, panes.length - 1)];
    activePaneId = null;
    setActivePane(next);
  }
  updatePanesLayout();
  updateChrome();
  refreshSidebar();
}

function closeActivePane() {
  const p = activePane();
  if (p) closePane(p);
}

function setPaneDirty(pane, v) {
  if (pane.dirty === v) return;
  pane.dirty = v;
  updatePaneHeader(pane);
  if (pane.id === activePaneId) updateChrome();
}

// Compat: setDirty aplica ao pane ativo.
function setDirty(v) {
  const p = activePane();
  if (p) setPaneDirty(p, v);
}

function updateChrome() {
  const p = activePane();
  const isDirty = !!(p && p.dirty);
  const name = p && p.path ? baseName(p.path) : 'nenhum arquivo';
  titlebarTitle.textContent = (isDirty ? '● ' : '') + name;
  titlebarTitle.title = (p && p.path) || '';
  titlebarTitle.classList.toggle('dirty', isDirty);
  window.wired.setTitle((isDirty ? '● ' : '') + name + ' | wired-md');
}

// --- file tree (árvore da pasta da nota aberta, estilo Obsidian) ---

let treeRoot = null; // pasta raiz da árvore (pasta da nota aberta)
const expandedDirs = new Set(); // paths de subpastas abertas (fechadas por padrão; estado preservado entre refreshes)
let treeFiles = []; // lista achatada de arquivos da árvore atual (quick switcher)
let selectedDir = null; // última pasta clicada na árvore (alvo de "novo arquivo" e "nova pasta")
let treeFilter = ''; // filtro da busca da toolbar (vazio = sem filtro)
let lastTree = null; // última árvore recebida do main (pra re-render sem IPC)

// Ordena a árvore conforme config.treeSort: az, za ou recente (modificado
// primeiro). Pastas ficam sempre por nome (invertido no za).
function sortNode(node) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  const mode = config.treeSort || 'az';
  node.dirs.sort(byName);
  if (mode === 'za') node.dirs.reverse();
  if (mode === 'recente') node.files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  else {
    node.files.sort(byName);
    if (mode === 'za') node.files.reverse();
  }
  for (const d of node.dirs) sortNode(d);
  return node;
}

// Poda a árvore pelo filtro da busca: fica o arquivo cujo nome contém o termo
// e a pasta que tem algum descendente que fica.
function filterNode(node, term) {
  const files = node.files.filter((f) => f.name.toLowerCase().includes(term));
  const dirs = [];
  for (const d of node.dirs) {
    const sub = filterNode(d, term);
    if (sub.files.length > 0 || sub.dirs.length > 0) dirs.push(Object.assign({}, d, { dirs: sub.dirs, files: sub.files }));
  }
  return { dirs, files };
}

function fileRow(f, depth) {
  const row = document.createElement('div');
  row.className = 'tree-row file';
  row.style.paddingLeft = 10 + depth * 14 + 'px';
  row.title = f.path;
  const ico = svgIcon(13, ICON_FILE);
  ico.classList.add('tree-ico');
  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = f.name;
  row.appendChild(ico);
  row.appendChild(name);
  const p = activePane();
  if (p && f.path === p.path) row.classList.add('active');
  // Ctrl+clique abre num pane novo ao lado, clique simples abre no pane ativo.
  row.addEventListener('click', (e) => {
    selectedDir = dirName(f.path);
    openPath(f.path, e.ctrlKey);
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showFileContextMenu(e, f.path);
  });
  return row;
}

function renderTreeLevel(container, node, depth) {
  for (const d of node.dirs) {
    const row = document.createElement('div');
    row.className = 'tree-row folder';
    row.style.paddingLeft = 10 + depth * 14 + 'px';
    row.title = d.path;
    const chev = svgIcon(11, ICON_CHEVRON);
    chev.classList.add('tree-chevron');
    const ico = svgIcon(13, ICON_FOLDER);
    ico.classList.add('tree-ico');
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = d.name;
    row.appendChild(chev);
    row.appendChild(ico);
    row.appendChild(name);
    const children = document.createElement('div');
    children.className = 'tree-children';
    // Com filtro ativo, tudo que sobrou fica aberto pra mostrar os matches.
    const open = treeFilter ? true : expandedDirs.has(d.path);
    row.classList.toggle('open', open);
    children.style.display = open ? '' : 'none';
    row.addEventListener('click', () => {
      selectedDir = d.path;
      if (treeFilter) return; // durante a busca a árvore fica toda aberta
      if (expandedDirs.has(d.path)) expandedDirs.delete(d.path);
      else expandedDirs.add(d.path);
      const nowOpen = expandedDirs.has(d.path);
      row.classList.toggle('open', nowOpen);
      children.style.display = nowOpen ? '' : 'none';
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFolderContextMenu(e, d.path);
    });
    container.appendChild(row);
    renderTreeLevel(children, d, depth + 1);
    container.appendChild(children);
  }
  for (const f of node.files) container.appendChild(fileRow(f, depth + 0.35));
}

function flattenTree(node, out) {
  for (const f of node.files) out.push(f);
  for (const d of node.dirs) flattenTree(d, out);
  return out;
}

// Desenha a árvore já em memória (ordenada e filtrada), sem novo IPC.
function renderTree() {
  fileTreeEl.innerHTML = '';
  if (!lastTree) {
    sidebarEmpty.style.display = 'block';
    return;
  }
  const sorted = sortNode({ dirs: lastTree.dirs.slice(), files: lastTree.files.slice() });
  const term = treeFilter.trim().toLowerCase();
  const view = term ? filterNode(sorted, term) : sorted;
  if (view.dirs.length === 0 && view.files.length === 0) {
    sidebarEmpty.textContent = term ? 'nada encontrado' : 'nenhuma pasta aberta';
    sidebarEmpty.style.display = 'block';
    return;
  }
  sidebarEmpty.style.display = 'none';
  renderTreeLevel(fileTreeEl, view, 0);
}

async function refreshSidebar() {
  renderRecents();
  const p = activePane();
  const cur = p ? p.path : null;
  if (!cur) {
    lastTree = null;
    sidebarRootName.textContent = 'sem pasta';
    sidebarRootName.title = '';
    renderTree();
    return;
  }
  const dir = dirName(cur);
  if (dir !== treeRoot) {
    treeRoot = dir;
    expandedDirs.clear();
    selectedDir = null;
    // Subpastas nascem fechadas quando a raiz muda; abrir é um clique.
    window.wired.watchDir(dir);
  }
  // Cabeçalho: nome da pasta raiz, com o path completo no tooltip.
  sidebarRootName.textContent = baseName(dir);
  sidebarRootName.title = dir;
  const res = await window.wired.dirTree(dir);
  const tree = res.tree || { dirs: [], files: [] };
  treeFiles = flattenTree(tree, []);
  lastTree = res.ok ? tree : null;
  renderTree();
}

window.wired.onDirChanged(() => {
  refreshSidebar();
});

// --- arquivos recentes ---

const MAX_RECENT = 12;

function pushRecent(p) {
  config.recentFiles = [p, ...(config.recentFiles || []).filter((r) => r !== p)].slice(0, MAX_RECENT);
  saveConfig();
  renderRecents();
}

function renderRecents() {
  recentListEl.innerHTML = '';
  const list = config.recentFiles || [];
  recentSection.style.display = list.length > 0 ? '' : 'none';
  const ap = activePane();
  for (const p of list) {
    const li = document.createElement('li');
    li.textContent = baseName(p);
    li.title = p;
    if (ap && p === ap.path) li.classList.add('active');
    li.addEventListener('click', (e) => openPath(p, e.ctrlKey));
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showRecentContextMenu(e, p);
    });
    recentListEl.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// dialog de input (nome de arquivo, pasta, renomear): prompt() não existe no
// Electron, então o app tem o seu, na paleta do tema.
// ---------------------------------------------------------------------------

const inputOverlay = document.getElementById('input-overlay');
const inputTitle = document.getElementById('input-title');
const inputField = document.getElementById('input-field');
const inputOk = document.getElementById('input-ok');
const inputCancel = document.getElementById('input-cancel');
let inputResolve = null;

function askInput(title, value, okLabel) {
  return new Promise((resolve) => {
    inputResolve = resolve;
    inputTitle.textContent = title;
    inputOk.textContent = okLabel || 'ok';
    inputField.value = value || '';
    inputOverlay.classList.remove('hidden');
    inputField.focus();
    // Pré-seleciona o nome sem a extensão, como o Explorer faz no renomear.
    const dot = inputField.value.lastIndexOf('.');
    inputField.setSelectionRange(0, dot > 0 ? dot : inputField.value.length);
  });
}

function closeInput(result) {
  inputOverlay.classList.add('hidden');
  const r = inputResolve;
  inputResolve = null;
  if (r) r(result);
}

inputOk.addEventListener('click', () => closeInput(inputField.value.trim() || null));
inputCancel.addEventListener('click', () => closeInput(null));
inputOverlay.addEventListener('mousedown', (e) => {
  if (e.target === inputOverlay) closeInput(null);
});
inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    closeInput(inputField.value.trim() || null);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeInput(null);
  }
  e.stopPropagation();
});

// ---------------------------------------------------------------------------
// menu de contexto custom (HTML, na paleta do app; Esc ou clique fora fecha)
// ---------------------------------------------------------------------------

function hideCtxMenu() {
  ctxMenuEl.classList.add('hidden');
}

function showCtxMenu(x, y, items) {
  ctxMenuEl.innerHTML = '';
  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      ctxMenuEl.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '');
    row.textContent = it.label;
    row.addEventListener('click', () => {
      hideCtxMenu();
      it.run();
    });
    ctxMenuEl.appendChild(row);
  }
  ctxMenuEl.classList.remove('hidden');
  // Reinicia a animação de entrada e posiciona sem sair da janela.
  ctxMenuEl.style.animation = 'none';
  void ctxMenuEl.offsetHeight;
  ctxMenuEl.style.animation = '';
  const r = ctxMenuEl.getBoundingClientRect();
  ctxMenuEl.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
  ctxMenuEl.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
}

window.addEventListener(
  'mousedown',
  (e) => {
    if (!ctxMenuEl.classList.contains('hidden') && !ctxMenuEl.contains(e.target)) hideCtxMenu();
  },
  true
);

// ---------------------------------------------------------------------------
// operações de arquivo (toolbar da tree e menu de contexto)
// ---------------------------------------------------------------------------

// Pane aberto com esse path, se houver.
function paneWithPath(p) {
  return panes.find((x) => x.path === p) || null;
}

// Depois de renomear (ou mover), corrige panes e recentes que apontavam pro path antigo.
function pathRenamed(from, to) {
  const pane = paneWithPath(from);
  if (pane) {
    pane.path = to;
    updatePaneHeader(pane);
    if (pane.id === activePaneId) updateChrome();
  }
  const isDir = !/\.(md|markdown)$/i.test(from);
  // o map pode gerar duplicata quando o path de destino já estava nos
  // recentes (sessão antiga), então dedup preservando a ordem
  config.recentFiles = [...new Set((config.recentFiles || []).map((r) => {
    if (r === from) return to;
    if (isDir && r.startsWith(from + '\\')) return to + r.slice(from.length);
    return r;
  }))];
  saveConfig();
  refreshSidebar();
}

function forgetPath(p) {
  const pane = paneWithPath(p);
  if (pane) {
    setPaneDirty(pane, false);
    closePane(pane);
  }
  config.recentFiles = (config.recentFiles || []).filter((r) => r !== p && !r.startsWith(p + '\\'));
  saveConfig();
  refreshSidebar();
}

async function createNewMd(targetDir) {
  const dir = targetDir || selectedDir || treeRoot;
  if (!dir) {
    newFile();
    return;
  }
  let name = await askInput('novo arquivo em ' + baseName(dir), 'sem-título.md', 'criar');
  if (!name) return;
  if (!/\.(md|markdown)$/i.test(name)) name += '.md';
  const res = await window.wired.createFile(dir + '\\' + name);
  if (!res.ok) {
    alert('Não deu pra criar o arquivo: ' + res.error);
    return;
  }
  await openPath(res.path, false);
}

async function createNewFolder(targetDir) {
  const dir = targetDir || selectedDir || treeRoot;
  if (!dir) return;
  const name = await askInput('nova pasta em ' + baseName(dir), 'nova pasta', 'criar');
  if (!name) return;
  const res = await window.wired.createDir(dir + '\\' + name);
  if (!res.ok) {
    alert('Não deu pra criar a pasta: ' + res.error);
    return;
  }
  expandedDirs.add(res.path);
  refreshSidebar();
}

// ---------------------------------------------------------------------------
// novo arquivo a partir de template (com variáveis)
// Templates são .md em %APPDATA%\wired-md\templates (semeados de templates\ do
// repo no primeiro boot). A pasta é relida toda vez que o seletor abre, então
// template largado ali com o app aberto aparece sem reiniciar.
// ---------------------------------------------------------------------------

const templateOverlay = document.getElementById('template-overlay');
const templateListEl = document.getElementById('template-list');

let templateItems = []; // [{ file, name }] na tela
let templateSel = 0;
let templateResolve = null;

// Sugestão de nome pra quem tem convenção fixa; o resto cai no padrão.
const TEMPLATE_SUGESTAO = { 'skill.md': 'SKILL.md', 'claude-md.md': 'CLAUDE.md' };

// Marcador de caret. O arquivo em disco nunca vê isto: ele é gravado já sem o
// {{cursor}}. O token só existe dentro do editor por um instante, pra achar o
// ponto no DOM renderizado, e sai do texto assim que o caret é posto lá.
const CURSOR_TOKEN = String.fromCharCode(0xe000); // caractere de uso privado do Unicode, invisível

const RE_VAR = /\{\{\s*([^{}]+?)\s*\}\}/g;

function dataDeHoje() {
  const d = new Date();
  const dois = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());
}

function horaDeAgora() {
  const d = new Date();
  const dois = (n) => String(n).padStart(2, '0');
  return dois(d.getHours()) + ':' + dois(d.getMinutes());
}

// Labels de {{pergunta:...}} na ordem em que aparecem, sem repetir: o mesmo
// label perguntado uma vez só e substituído em todas as ocorrências.
function templatePerguntas(texto) {
  const labels = [];
  const re = new RegExp(RE_VAR.source, 'g');
  let m;
  while ((m = re.exec(texto))) {
    const chave = m[1].trim();
    if (!/^pergunta\s*:/i.test(chave)) continue;
    const label = chave.slice(chave.indexOf(':') + 1).trim();
    if (label && labels.indexOf(label) === -1) labels.push(label);
  }
  return labels;
}

// Marcador que o app não conhece fica INTACTO no texto, nunca vira erro.
function aplicarVariaveis(texto, ctx) {
  return texto.replace(new RegExp(RE_VAR.source, 'g'), (todo, bruto) => {
    const chave = bruto.trim();
    const low = chave.toLowerCase();
    if (low === 'data') return ctx.data;
    if (low === 'hora') return ctx.hora;
    if (low === 'titulo' || low === 'título') return ctx.titulo;
    if (low === 'pasta') return ctx.pasta;
    if (low === 'cursor') return ctx.cursor;
    if (/^pergunta\s*:/i.test(chave)) {
      const label = chave.slice(chave.indexOf(':') + 1).trim();
      return Object.prototype.hasOwnProperty.call(ctx.respostas, label) ? ctx.respostas[label] : todo;
    }
    return todo;
  });
}

function markTemplateSel() {
  const rows = templateListEl.querySelectorAll('.palette-row');
  rows.forEach((r, i) => r.classList.toggle('selected', i === templateSel));
  const sel = rows[templateSel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function moveTemplateSel(delta) {
  if (templateItems.length === 0) return;
  templateSel = (templateSel + delta + templateItems.length) % templateItems.length;
  markTemplateSel();
}

function closeTemplatePicker(item) {
  if (templateOverlay.classList.contains('hidden')) return;
  templateOverlay.classList.add('hidden');
  window.removeEventListener('keydown', templateKeydown, true);
  const r = templateResolve;
  templateResolve = null;
  if (r) r(item || null);
}

function templateKeydown(e) {
  if (templateOverlay.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveTemplateSel(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveTemplateSel(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    closeTemplatePicker(templateItems[templateSel]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeTemplatePicker(null);
  } else {
    return;
  }
  e.stopPropagation();
}

async function pickTemplate() {
  const lista = await window.wired.listTemplates();
  templateItems = Array.isArray(lista) ? lista : [];
  templateSel = 0;
  templateListEl.innerHTML = '';
  if (templateItems.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'palette-empty';
    vazio.textContent = 'nenhum template na pasta';
    templateListEl.appendChild(vazio);
  }
  templateItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'palette-row' + (i === 0 ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'palette-label';
    label.textContent = item.name;
    const hint = document.createElement('span');
    hint.className = 'palette-hint';
    hint.textContent = item.file;
    row.appendChild(label);
    row.appendChild(hint);
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      closeTemplatePicker(item);
    });
    templateListEl.appendChild(row);
  });
  templateOverlay.classList.remove('hidden');
  window.addEventListener('keydown', templateKeydown, true);
  return new Promise((resolve) => {
    templateResolve = resolve;
  });
}

templateOverlay.addEventListener('mousedown', (e) => {
  if (e.target === templateOverlay) closeTemplatePicker(null);
});

document.getElementById('btn-template-folder').addEventListener('click', () => window.wired.openTemplatesFolder());

// Coloca o caret onde estava o {{cursor}}. O truque: reabrir o conteúdo com um
// token invisível, achar o token no DOM renderizado, tirar ele do nó de texto e
// deixar o caret exatamente ali. Se o token não sobreviver ao render, volta pro
// conteúdo limpo e o caret fica no fim (melhor esforço declarado).
function colocarCursorNoMarcador(pane, comMarca, limpo) {
  if (!pane || !pane.vditor) return;
  if (comMarca === limpo) {
    pane.vditor.focus();
    return;
  }
  pane.vditor.setValue(comMarca);
  setTimeout(() => {
    const raiz = pane.el.querySelector('.vditor-ir .vditor-reset');
    let achou = false;
    if (raiz) {
      const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.nodeValue.indexOf(CURSOR_TOKEN);
        if (i === -1) continue;
        node.nodeValue = node.nodeValue.slice(0, i) + node.nodeValue.slice(i + CURSOR_TOKEN.length);
        try {
          const range = document.createRange();
          range.setStart(node, i);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          if (node.parentElement) node.parentElement.scrollIntoView({ block: 'center' });
          achou = true;
        } catch {}
        break;
      }
    }
    if (!achou) pane.vditor.setValue(limpo);
    setPaneDirty(pane, false);
    refreshFmPanel(pane);
  }, 120);
}

// Fluxo: escolher template, nome do arquivo, responder as perguntas e só então
// criar. Cancelar (Esc ou campo vazio) em qualquer passo não deixa nada em
// disco, porque o arquivo só nasce depois da última resposta.
async function newFromTemplate(targetDir) {
  const dir = targetDir || selectedDir || treeRoot;
  const tpl = await pickTemplate();
  if (!tpl) return;
  const lido = await window.wired.readTemplate(tpl.file);
  if (!lido.ok) {
    alert('Não deu pra ler o template: ' + lido.error);
    return;
  }
  const sugestao = TEMPLATE_SUGESTAO[tpl.file.toLowerCase()] || 'sem-título.md';
  let nome = await askInput('novo a partir de ' + tpl.name + (dir ? ' em ' + baseName(dir) : ''), sugestao, 'criar');
  if (!nome) return;
  if (!/\.(md|markdown)$/i.test(nome)) nome += '.md';
  const respostas = {};
  for (const label of templatePerguntas(lido.content)) {
    const resposta = await askInput(label, '', 'ok');
    if (resposta === null) return;
    respostas[label] = resposta;
  }
  const base = {
    data: dataDeHoje(),
    hora: horaDeAgora(),
    titulo: nome.replace(/\.(md|markdown)$/i, ''),
    pasta: dir ? baseName(dir) : '',
    respostas
  };
  const comMarca = aplicarVariaveis(lido.content, Object.assign({ cursor: CURSOR_TOKEN }, base));
  const limpo = comMarca.split(CURSOR_TOKEN).join('');
  // Sem pasta aberta: o texto vai pro buffer sem título, igual ao "novo arquivo".
  if (!dir) {
    newFile();
    const pane = activePane();
    if (pane && pane.vditor) {
      colocarCursorNoMarcador(pane, comMarca, limpo);
      setPaneDirty(pane, true);
    }
    return;
  }
  const alvo = dir + '\\' + nome;
  const criado = await window.wired.createFile(alvo);
  if (!criado.ok) {
    alert('Não deu pra criar o arquivo: ' + criado.error);
    return;
  }
  const gravado = await window.wired.writeFile(alvo, limpo);
  if (!gravado.ok) {
    alert('Não deu pra escrever o template no arquivo: ' + gravado.error);
    return;
  }
  await openPath(alvo, false);
  colocarCursorNoMarcador(activePane(), comMarca, limpo);
}

async function renameItem(p) {
  const oldName = baseName(p);
  let name = await askInput('renomear ' + oldName, oldName, 'renomear');
  if (!name || name === oldName) return;
  if (/\.(md|markdown)$/i.test(oldName) && !/\.(md|markdown)$/i.test(name)) name += '.md';
  const to = dirName(p) + '\\' + name;
  const res = await window.wired.renamePath(p, to);
  if (!res.ok) {
    alert('Não deu pra renomear: ' + res.error);
    return;
  }
  if (expandedDirs.has(p)) {
    expandedDirs.delete(p);
    expandedDirs.add(to);
  }
  pathRenamed(p, to);
}

async function trashItem(p) {
  const isDir = !/\.(md|markdown)$/i.test(p);
  if (!confirm('Mandar "' + baseName(p) + '" pra lixeira' + (isDir ? ' (a pasta inteira)' : '') + '?')) return;
  const res = await window.wired.trashPath(p);
  if (!res.ok) {
    alert('Não deu pra excluir: ' + res.error);
    return;
  }
  forgetPath(p);
}

async function duplicateItem(p) {
  const res = await window.wired.duplicateFile(p);
  if (!res.ok) {
    alert('Não deu pra duplicar: ' + res.error);
    return;
  }
  refreshSidebar();
}

function copyPathToClipboard(p) {
  navigator.clipboard.writeText(p).catch(() => {});
}

async function exportItem(p) {
  const res = await window.wired.exportFile(p);
  if (!res.ok && !res.canceled) alert('Não deu pra exportar: ' + res.error);
}

function showFileContextMenu(e, p) {
  showCtxMenu(e.clientX, e.clientY, [
    { label: 'abrir', run: () => openPath(p, false) },
    { label: 'abrir ao lado', run: () => openPath(p, true) },
    { sep: true },
    { label: 'renomear', run: () => renameItem(p) },
    { label: 'duplicar', run: () => duplicateItem(p) },
    { sep: true },
    { label: 'copiar caminho', run: () => copyPathToClipboard(p) },
    { label: 'exportar...', run: () => exportItem(p) },
    { label: 'abrir no Explorer', run: () => window.wired.showInFolder(p) },
    { sep: true },
    { label: 'excluir (lixeira)', danger: true, run: () => trashItem(p) }
  ]);
}

function showFolderContextMenu(e, p) {
  showCtxMenu(e.clientX, e.clientY, [
    { label: 'novo arquivo .md aqui', run: () => createNewMd(p) },
    { label: 'novo a partir de template aqui', run: () => newFromTemplate(p) },
    { label: 'nova pasta aqui', run: () => createNewFolder(p) },
    { sep: true },
    { label: 'renomear', run: () => renameItem(p) },
    { label: 'abrir no Explorer', run: () => window.wired.showInFolder(p) },
    { sep: true },
    { label: 'excluir (lixeira)', danger: true, run: () => trashItem(p) }
  ]);
}

function showRecentContextMenu(e, p) {
  showCtxMenu(e.clientX, e.clientY, [
    { label: 'abrir', run: () => openPath(p, false) },
    { label: 'abrir ao lado', run: () => openPath(p, true) },
    { sep: true },
    { label: 'copiar caminho', run: () => copyPathToClipboard(p) },
    { label: 'abrir no Explorer', run: () => window.wired.showInFolder(p) },
    { sep: true },
    {
      label: 'remover dos recentes',
      run: () => {
        config.recentFiles = (config.recentFiles || []).filter((r) => r !== p);
        saveConfig();
        renderRecents();
      }
    }
  ]);
}

// --- toolbar da tree (estilo Obsidian) ---

const SORT_LABELS = { az: 'nome A a Z', za: 'nome Z a A', recente: 'modificado primeiro' };

function setTreeSort(mode) {
  config.treeSort = mode;
  saveConfig();
  renderTree();
  updateSortTooltip();
}

function updateSortTooltip() {
  const btn = document.getElementById('btn-tree-sort');
  btn.title = 'Ordenação: ' + (SORT_LABELS[config.treeSort] || SORT_LABELS.az);
}

document.getElementById('btn-tree-new-file').addEventListener('click', () => createNewMd());
document.getElementById('btn-tree-template').addEventListener('click', () => newFromTemplate());
document.getElementById('btn-tree-new-folder').addEventListener('click', () => createNewFolder());
document.getElementById('btn-tree-collapse').addEventListener('click', () => {
  expandedDirs.clear();
  renderTree();
});
document.getElementById('btn-tree-sort').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  showCtxMenu(r.left, r.bottom + 4, ['az', 'za', 'recente'].map((m) => ({
    label: SORT_LABELS[m],
    checked: (config.treeSort || 'az') === m,
    run: () => setTreeSort(m)
  })));
});

function toggleTreeSearch(forceOpen) {
  const isHidden = treeSearchWrap.classList.contains('hidden');
  const open = forceOpen === undefined ? isHidden : forceOpen;
  treeSearchWrap.classList.toggle('hidden', !open);
  if (open) {
    treeSearchInput.focus();
  } else {
    treeSearchInput.value = '';
    treeFilter = '';
    renderTree();
  }
}

document.getElementById('btn-tree-search').addEventListener('click', () => toggleTreeSearch());
document.getElementById('btn-root-explorer').addEventListener('click', () => {
  if (treeRoot) window.wired.showInFolder(treeRoot);
});

treeSearchInput.addEventListener('input', () => {
  treeFilter = treeSearchInput.value;
  renderTree();
});
treeSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    toggleTreeSearch(false);
  }
  e.stopPropagation();
});

// Abre o arquivo num pane. Com side=true, abre num pane novo à direita
// (respeitando o teto de 4); se o arquivo já está aberto em algum pane,
// só ativa o pane dele.
async function openPath(p, side) {
  const existing = panes.find((x) => x.path === p);
  if (existing) {
    setActivePane(existing);
    pushRecent(p); // volta pro topo dos recentes mesmo sem reabrir
    return;
  }
  let pane;
  if (side) {
    pane = createPane();
    if (pane) setActivePane(pane);
    else pane = activePane(); // teto de panes: degrada pro pane ativo
  } else {
    pane = activePane();
  }
  if (!pane) return;
  await openInPane(pane, p);
}

async function openInPane(pane, p) {
  if (!pane.ready) {
    pane.pendingPath = p;
    return;
  }
  if (pane.path === p) return;
  if (pane.dirty && !confirm('Há alterações não salvas. Descartar e abrir outro arquivo?')) return;
  const res = await window.wired.readFile(p);
  if (!res.ok) {
    alert('Não foi possível abrir o arquivo: ' + res.error);
    return;
  }
  pane.path = p;
  pane.vditor.setValue(res.content);
  setPaneDirty(pane, false);
  refreshFmPanel(pane);
  // setValue troca os blocos do DOM: o marcador de foco tem que ser refeito.
  applyFocusMode();
  updatePaneHeader(pane);
  if (pane.id === activePaneId) updateChrome();
  pushRecent(p);
  refreshSidebar();
}

async function save() {
  const pane = activePane();
  if (!pane || !pane.vditor) return;
  if (!pane.path) {
    saveAs();
    return;
  }
  const res = await window.wired.writeFile(pane.path, pane.vditor.getValue());
  if (!res.ok) {
    alert('Falha ao salvar: ' + res.error);
    return;
  }
  setPaneDirty(pane, false);
}

async function saveAs() {
  const pane = activePane();
  if (!pane || !pane.vditor) return;
  const p = await window.wired.saveAsDialog(pane.path);
  if (!p) return;
  const res = await window.wired.writeFile(p, pane.vditor.getValue());
  if (!res.ok) {
    alert('Falha ao salvar: ' + res.error);
    return;
  }
  pane.path = p;
  setPaneDirty(pane, false);
  refreshFmPanel(pane); // o nome do arquivo decide o schema (SKILL.md, agents/)
  updatePaneHeader(pane);
  updateChrome();
  pushRecent(p);
  refreshSidebar();
}

function newFile() {
  const pane = activePane();
  if (!pane || !pane.vditor) return;
  if (pane.dirty && !confirm('Há alterações não salvas. Descartar e criar um novo arquivo?')) return;
  pane.path = null;
  pane.vditor.setValue('');
  setPaneDirty(pane, false);
  refreshFmPanel(pane);
  updatePaneHeader(pane);
  updateChrome();
  refreshSidebar();
}

async function openViaDialog(side) {
  const p = await window.wired.openDialog();
  if (p) openPath(p, !!side);
}

// ---------------------------------------------------------------------------
// temas, accent, fontes e snippets
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

// Deriva as variantes do accent a partir de uma cor só, no mesmo espírito da
// paleta original (soft mais claro, ink levemente escurecido, dim bem escuro).
function accentCss(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const soft = rgbToHex(mix(rgb, [255, 255, 255], 0.28));
  const ink = rgbToHex(mix(rgb, [0, 0, 0], 0.08));
  const dim = rgbToHex(mix(rgb, [0, 0, 0], 0.32));
  return [
    '--accent:' + hex + ';',
    '--accent-soft:' + soft + ';',
    '--accent-ink:' + ink + ';',
    '--accent-dim:' + dim + ';',
    '--accent-rgb:' + rgb.map(Math.round).join(',') + ';'
  ].join('');
}

// --- contraste: o piso de 4.5:1 pro texto é regra dura aqui (astigmatismo do
// dono), então a opacidade do modo foco é MEDIDA no tema ativo, nunca chutada.

function relLuminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrastRatio(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Menor opacidade que ainda deixa o texto esmaecido em 4.6:1 (uma casa acima do
// piso) contra o fundo do tema ATIVO. No wired dá 0.62 (4,66:1); no claro, que
// perde contraste bem mais rápido, dá 0.76 (também 4,66:1). Tema de terceiro entra na
// mesma conta. Cor que não dá pra ler em hex devolve null e o valor do tema fica.
function focusDimFor(bgHex, inkHex) {
  const bg = hexToRgb(bgHex || '');
  const ink = hexToRgb(inkHex || '');
  if (!bg || !ink) return null;
  for (let a = 0.4; a <= 0.95; a += 0.01) {
    const comp = ink.map((v, i) => bg[i] + (v - bg[i]) * a);
    if (contrastRatio(bg, comp) >= 4.6) return Math.round(a * 100) / 100;
  }
  return 0.95;
}

function cssFontValue(name) {
  const clean = name.trim().replace(/["';{}]/g, '');
  return clean ? '"' + clean + '",' : '';
}

// Reconstrói o <style> de overrides do usuário a partir do config.
function applyCustom() {
  let vars = '';
  if (config.accent) vars += accentCss(config.accent);
  if (config.fontBody) vars += '--font-body:' + cssFontValue(config.fontBody) + 'var(--font-body-default);';
  if (config.fontCode) vars += '--font-code:' + cssFontValue(config.fontCode) + 'var(--font-code-default);';
  if (config.fontSize) vars += '--font-size-body:' + Number(config.fontSize) + 'px;';
  // A opacidade do modo foco é recalculada a cada troca de tema, pra o texto
  // esmaecido nunca cair do piso de 4.5:1 em tema nenhum (inclusive nos temas
  // já semeados em %APPDATA%, que não declaram a variável).
  const cs = getComputedStyle(document.documentElement);
  const dim = focusDimFor(cs.getPropertyValue('--bg').trim(), cs.getPropertyValue('--ink').trim());
  if (dim !== null) vars += '--focus-dim:' + dim + ';';
  customStyle.textContent = vars ? ':root{' + vars + '}' : '';
  applyTerminalTheme();
}

async function applyTheme(name) {
  const res = await window.wired.readTheme(name);
  themeStyle.textContent = res.ok ? res.css : '';
  applyCustom();
}

let snippetStyles = [];
async function applySnippets() {
  for (const el of snippetStyles) el.remove();
  snippetStyles = [];
  for (const file of config.snippets) {
    const res = await window.wired.readSnippet(file);
    if (!res.ok) continue;
    const el = document.createElement('style');
    el.dataset.snippet = file;
    el.textContent = res.css;
    document.head.appendChild(el);
    snippetStyles.push(el);
  }
}

async function saveConfig() {
  await window.wired.setConfig(config);
}

// --- painel de configurações ---

const settingsOverlay = document.getElementById('settings-overlay');
const selTheme = document.getElementById('sel-theme');
const inpAccent = document.getElementById('inp-accent');
const inpFontBody = document.getElementById('inp-font-body');
const inpFontCode = document.getElementById('inp-font-code');
const inpFontSize = document.getElementById('inp-font-size');
const snippetListEl = document.getElementById('snippet-list');

// Fontes que viajam com o app (src/renderer/fonts): aparecem primeiro na lista.
const BUNDLED_FONTS = ['Geist', 'Geist Mono', 'Mona Sans', 'Inter', 'Inter Display', 'Satoshi'];

const FALLBACK_FONTS = [
  'Segoe UI', 'Calibri', 'Cambria', 'Georgia', 'Verdana', 'Tahoma', 'Arial',
  'Times New Roman', 'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code',
  'Consolas', 'Courier New', 'Fira Code', 'Iosevka', 'Roboto'
];

async function fillFontOptions() {
  const datalist = document.getElementById('font-options');
  let systemNames = FALLBACK_FONTS;
  try {
    if (window.queryLocalFonts) {
      const fonts = await window.queryLocalFonts();
      const set = new Set(fonts.map((f) => f.family));
      if (set.size > 0) systemNames = [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }
  } catch {
    // sem permissão para listar fontes do sistema; fica a lista fixa
  }
  const names = [...BUNDLED_FONTS, ...systemNames.filter((n) => !BUNDLED_FONTS.includes(n))];
  datalist.innerHTML = '';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    datalist.appendChild(opt);
  }
}

async function fillThemeSelect() {
  const themes = await window.wired.listThemes();
  selTheme.innerHTML = '';
  for (const t of themes) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === config.theme) opt.selected = true;
    selTheme.appendChild(opt);
  }
}

async function fillSnippetList() {
  const files = await window.wired.listSnippets();
  snippetListEl.innerHTML = '';
  if (files.length === 0) {
    const p = document.createElement('p');
    p.className = 'setting-hint';
    p.textContent = 'nenhum snippet na pasta ainda.';
    snippetListEl.appendChild(p);
    return;
  }
  for (const f of files) {
    const row = document.createElement('label');
    row.className = 'snippet-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = config.snippets.includes(f);
    cb.addEventListener('change', async () => {
      if (cb.checked) {
        if (!config.snippets.includes(f)) config.snippets.push(f);
      } else {
        config.snippets = config.snippets.filter((s) => s !== f);
      }
      await applySnippets();
      saveConfig();
    });
    const span = document.createElement('span');
    span.textContent = f;
    row.appendChild(cb);
    row.appendChild(span);
    snippetListEl.appendChild(row);
  }
}

function currentAccentHex() {
  if (config.accent) return config.accent;
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#4fc7bb';
}

async function openSettings() {
  await Promise.all([fillThemeSelect(), fillSnippetList(), fillFontOptions()]);
  inpAccent.value = currentAccentHex();
  inpFontBody.value = config.fontBody || '';
  inpFontCode.value = config.fontCode || '';
  inpFontSize.value = config.fontSize || 15;
  settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

document.getElementById('btn-settings-close').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

selTheme.addEventListener('change', async () => {
  config.theme = selTheme.value;
  await applyTheme(config.theme);
  inpAccent.value = currentAccentHex();
  saveConfig();
});

inpAccent.addEventListener('input', () => {
  config.accent = inpAccent.value;
  applyCustom();
});
inpAccent.addEventListener('change', () => saveConfig());

document.getElementById('btn-accent-reset').addEventListener('click', () => {
  config.accent = null;
  applyCustom();
  inpAccent.value = currentAccentHex();
  saveConfig();
});

function bindTextSetting(input, key) {
  input.addEventListener('change', () => {
    config[key] = input.value.trim();
    applyCustom();
    saveConfig();
  });
}
bindTextSetting(inpFontBody, 'fontBody');
bindTextSetting(inpFontCode, 'fontCode');

inpFontSize.addEventListener('change', () => {
  const v = Number(inpFontSize.value);
  if (v >= 11 && v <= 26) {
    config.fontSize = v;
    applyCustom();
    saveConfig();
  }
});

document.getElementById('btn-open-snippets').addEventListener('click', () => window.wired.openSnippetsFolder());
document.getElementById('btn-open-themes').addEventListener('click', () => window.wired.openThemesFolder());
document.getElementById('btn-reload-snippets').addEventListener('click', async () => {
  await fillSnippetList();
  await applySnippets();
});

// ---------------------------------------------------------------------------
// terminal embutido
// ---------------------------------------------------------------------------

const terminalPanel = document.getElementById('terminal-panel');
const terminalHost = document.getElementById('terminal-host');
const terminalCwd = document.getElementById('terminal-cwd');

let xterm = null;
let fitAddon = null;
let termKind = null; // 'pty' | 'pipe' | null
let termRunning = false;
let pipeLine = ''; // buffer de linha do modo pipe (sem pty, o eco é local)

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyTerminalTheme() {
  if (!xterm) return;
  xterm.options.theme = {
    background: cssVar('--bg-2') || '#191d23',
    foreground: cssVar('--ink') || '#bcc2c9',
    cursor: cssVar('--accent') || '#4fc7bb',
    selectionBackground: 'rgba(' + (cssVar('--accent-rgb') || '79,199,187') + ',0.25)'
  };
}

function ensureXterm() {
  if (xterm) return;
  xterm = new Terminal({
    fontFamily: cssVar('--font-code') || '"JetBrains Mono","Cascadia Mono",Consolas,monospace',
    fontSize: 13,
    cursorBlink: true,
    convertEol: true,
    scrollback: 4000
  });
  fitAddon = new FitAddon.FitAddon();
  xterm.loadAddon(fitAddon);
  xterm.open(terminalHost);
  applyTerminalTheme();

  xterm.onData((data) => {
    if (!termRunning) return;
    if (termKind === 'pty') {
      window.wired.termInput(data);
      return;
    }
    // Modo pipe: edição de linha local, porque o powershell sem pty não ecoa.
    for (const ch of data) {
      if (ch === '\r') {
        xterm.write('\r\n');
        window.wired.termInput(pipeLine + '\r\n');
        pipeLine = '';
      } else if (ch === '\x7f' || ch === '\b') {
        if (pipeLine.length > 0) {
          pipeLine = pipeLine.slice(0, -1);
          xterm.write('\b \b');
        }
      } else if (ch === '\x03') {
        interruptTerminal();
      } else if (ch >= ' ' || ch === '\t') {
        pipeLine += ch;
        xterm.write(ch);
      }
    }
  });

  xterm.onResize(({ cols, rows }) => {
    if (termRunning) window.wired.termResize(cols, rows);
  });

  window.wired.onTermData((d) => {
    if (xterm) xterm.write(d);
  });

  window.wired.onTermExit((code) => {
    termRunning = false;
    if (xterm) xterm.write('\r\n[processo encerrado, código ' + code + ']\r\n');
  });

  new ResizeObserver(() => {
    if (!terminalPanel.classList.contains('hidden') && fitAddon) {
      try {
        fitAddon.fit();
      } catch {}
    }
  }).observe(terminalHost);
}

async function interruptTerminal() {
  const res = await window.wired.termInterrupt();
  if (res && res.restarted) {
    pipeLine = '';
    termRunning = true;
    xterm.write('\r\n[comando interrompido, shell reiniciado]\r\n');
  }
}

async function startTerminal() {
  const cwd = currentPath ? dirName(currentPath) : null;
  ensureXterm();
  fitAddon.fit();
  const res = await window.wired.termStart(cwd, xterm.cols, xterm.rows);
  if (!res.ok) {
    xterm.write('\r\n[não foi possível iniciar o shell: ' + res.error + ']\r\n');
    return;
  }
  termKind = res.kind;
  termRunning = true;
  pipeLine = '';
  terminalCwd.textContent = res.cwd || '';
  if (res.kind === 'pipe') {
    xterm.write('[modo compatibilidade: sem pty, eco local; Ctrl+C reinicia o shell]\r\n');
  }
}

function toggleTerminal(forceOpen) {
  const isHidden = terminalPanel.classList.contains('hidden');
  const open = forceOpen === undefined ? isHidden : forceOpen;
  if (open) {
    terminalPanel.classList.remove('hidden');
    applyTerminalHeight();
    ensureXterm();
    requestAnimationFrame(() => {
      fitAddon.fit();
      xterm.focus();
    });
    if (!termRunning) startTerminal();
  } else {
    terminalPanel.classList.add('hidden');
    if (vditor) vditor.focus();
  }
}

document.getElementById('btn-term-close').addEventListener('click', () => toggleTerminal(false));

// --- terminal redimensionável: arrastar a borda superior muda a altura,
// com clamp (120px a 70% da janela) e persistência no config. O fit do xterm
// acontece durante o arraste pelo ResizeObserver do host. ---

const terminalResizer = document.getElementById('terminal-resizer');

function clampTermHeight(h) {
  return Math.max(120, Math.min(Math.round(window.innerHeight * 0.7), Math.round(h)));
}

function setTerminalHeight(h) {
  const v = clampTermHeight(h);
  config.terminalHeight = v;
  terminalPanel.style.height = v + 'px';
}

function applyTerminalHeight() {
  terminalPanel.style.height = clampTermHeight(Number(config.terminalHeight) || 260) + 'px';
}

let termResizing = false;
terminalResizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  termResizing = true;
  document.body.classList.add('resizing-terminal');
});
window.addEventListener('mousemove', (e) => {
  if (!termResizing) return;
  setTerminalHeight(terminalPanel.getBoundingClientRect().bottom - e.clientY);
});
window.addEventListener('mouseup', () => {
  if (!termResizing) return;
  termResizing = false;
  document.body.classList.remove('resizing-terminal');
  saveConfig();
});

// Digita uma linha de comando no shell aberto (pty ou pipe), com Enter.
function termType(cmd) {
  if (!termRunning) return;
  if (termKind === 'pty') {
    window.wired.termInput(cmd + '\r');
  } else {
    xterm.write(cmd + '\r\n');
    window.wired.termInput(cmd + '\r\n');
    pipeLine = '';
  }
}

// Manda o shell aberto pra pasta da nota atual (cd), sem reiniciar o terminal.
function cdTerminalToNote() {
  if (!currentPath || !termRunning) return;
  const dir = dirName(currentPath);
  termType('cd "' + dir + '"');
  terminalCwd.textContent = dir;
  xterm.focus();
}

document.getElementById('btn-term-cd').addEventListener('click', cdTerminalToNote);

// Digita o comando claude no shell, já com Enter.
document.getElementById('btn-claude').addEventListener('click', () => {
  toggleTerminal(true);
  setTimeout(() => termType('claude'), 300);
});

// ---------------------------------------------------------------------------
// ponte claude por nota: abre o terminal, sobe uma sessão do claude, faz /cd
// pra pasta da nota e digita o path entre aspas SEM Enter final, deixando o
// cursor ali pro dono completar o prompt sem gastar token à toa. Sem API.
// ---------------------------------------------------------------------------

// Buffer visível do xterm como texto (pra detectar o prompt do claude subir).
function getTermBuffer() {
  if (!xterm) return '';
  const out = [];
  const b = xterm.buffer.active;
  for (let i = 0; i < b.length; i++) {
    const l = b.getLine(i);
    if (l) out.push(l.translateToString(true));
  }
  return out.join('\n');
}

// Digita texto no shell SEM Enter (o cursor fica no fim, esperando o dono).
function termTypeRaw(text) {
  if (!termRunning) return;
  if (termKind === 'pty') {
    window.wired.termInput(text);
  } else {
    xterm.write(text);
    pipeLine += text;
  }
}

// Espera a sessão do claude subir: o buffer cresce com a TUI e estabiliza
// (mínimo de 2s, teto de 15s; polling, porque o tempo varia por máquina).
async function waitClaudeReady() {
  const start = Date.now();
  let last = getTermBuffer();
  let stableSince = Date.now();
  while (Date.now() - start < 15000) {
    await sleep(300);
    const buf = getTermBuffer();
    if (buf !== last) {
      last = buf;
      stableSince = Date.now();
    }
    if (Date.now() - start >= 2000 && Date.now() - stableSince >= 900 && buf !== '') return;
  }
}

let claudeBridgeBusy = false;

// Fluxo da ponte: terminal aberto, sessão do claude de pé, /cd na pasta da
// nota e o path digitado entre aspas, sem Enter. Com seleção, ela vai citada
// depois do path (também sem Enter).
async function claudeBridge(notePath, selection) {
  if (!notePath) {
    alert('Nenhum arquivo aberto para mandar pro claude.');
    return;
  }
  if (claudeBridgeBusy) return;
  claudeBridgeBusy = true;
  try {
    toggleTerminal(true);
    const t0 = Date.now();
    while (!termRunning && Date.now() - t0 < 8000) await sleep(200);
    if (!termRunning) return;
    await sleep(400);
    termType('claude');
    await waitClaudeReady();
    termType('/cd ' + dirName(notePath));
    await sleep(600);
    let text = '"' + notePath + '" ';
    if (selection) text += 'sobre este trecho: "' + selection + '" ';
    termTypeRaw(text);
    if (xterm) xterm.focus();
  } finally {
    claudeBridgeBusy = false;
  }
}

function sendPaneToClaude(pane) {
  setActivePane(pane);
  claudeBridge(pane ? pane.path : null, '');
}

function sendFileToClaude() {
  claudeBridge(currentPath, '');
}

// Seleção capturada quando a palette abre (o foco no input pode derrubar a seleção do editor).
let lastSelection = '';

function currentSelectionText() {
  const sel = window.getSelection ? String(window.getSelection()) : '';
  return (sel || lastSelection || '').trim();
}

function sendSelectionToClaude() {
  const text = currentSelectionText();
  if (!text) {
    alert('Nenhum texto selecionado para mandar pro claude.');
    return;
  }
  const compact = text.replace(/\s+/g, ' ').slice(0, 2000);
  claudeBridge(currentPath, compact);
}

// ---------------------------------------------------------------------------
// painel de propriedades (frontmatter YAML), por pane
//
// O que foi entregue: VISTA DUPLA SINCRONIZADA. O bloco --- continua visível no
// documento (o Vditor IR tem nó próprio pra yaml-front-matter e faz round trip
// exato dele) e o painel é a vista estruturada em cima. Esconder o nó dentro do
// editor foi descartado: ele é contenteditable, então display:none deixa o
// cursor entrar nele por Ctrl+Home, seta pra cima ou Ctrl+A e a pessoa digitaria
// no escuro. Sincronização: editar no painel reescreve o bloco no documento;
// editar no documento refaz o painel (debounce).
// ---------------------------------------------------------------------------

// Frontmatter só conta no começo do arquivo, entre uma linha --- e a próxima.
const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/;

function splitFrontmatter(text) {
  if (!text || !text.startsWith('---')) return null;
  const m = FM_RE.exec(text);
  if (!m) return null;
  return { raw: m[1], bloco: m[0], corpo: text.slice(m[0].length) };
}

const MODELOS_COMUNS = ['sonnet', 'opus', 'haiku', 'inherit'];

// Chaves parecidas com as que valem: typo silencioso é o que quebra agente.
const FM_LOOKALIKES = {
  Name: 'name', NAME: 'name', nome: 'name', naem: 'name',
  Description: 'description', describe: 'description', desc: 'description',
  descricao: 'description', 'descrição': 'description', descript: 'description',
  Tools: 'tools', tool: 'tools', ferramentas: 'tools',
  Model: 'model', modelo: 'model', models: 'model'
};

// skill: SKILL.md. subagent: arquivo dentro de uma pasta agents, ou com name
// junto de tools/model. O resto é genérico (só a validade do YAML).
function fmSchema(p, keys) {
  const base = p ? baseName(p).toLowerCase() : '';
  const pasta = p ? baseName(dirName(p)).toLowerCase() : '';
  if (base === 'skill.md') return 'skill';
  if (pasta === 'agents') return 'subagent';
  if (keys.includes('name') && (keys.includes('tools') || keys.includes('model'))) return 'subagent';
  return 'generico';
}

function fmEntry(entries, key) {
  return entries.find((e) => e.key === key) || null;
}

// Devolve a lista de avisos (string curta em pt-BR). Nunca bloqueia nada.
function fmValidate(schema, entries) {
  const avisos = [];
  const keys = entries.map((e) => e.key);
  if (schema === 'generico') return avisos;

  const nome = fmEntry(entries, 'name');
  if (!nome) avisos.push('falta a chave name');
  else if (typeof nome.value !== 'string' || nome.value.trim() === '') avisos.push('name está vazio');
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(nome.value.trim())) avisos.push('name deve ser kebab-case: minúsculas, números e hífen, sem espaços');

  const desc = fmEntry(entries, 'description');
  if (!desc) avisos.push('falta a chave description');
  else if (typeof desc.value !== 'string' || desc.value.trim() === '') avisos.push('description está vazia');

  const tools = fmEntry(entries, 'tools');
  if (tools && tools.kind !== 'list' && typeof tools.value !== 'string') avisos.push('tools deve ser uma lista ou um texto separado por vírgula');

  const model = fmEntry(entries, 'model');
  if (model && typeof model.value === 'string' && model.value.trim() && !MODELOS_COMUNS.includes(model.value.trim().toLowerCase())) {
    avisos.push('model "' + model.value.trim() + '" não é um dos comuns (' + MODELOS_COMUNS.join(', ') + ')');
  }

  for (const k of keys) {
    const certa = FM_LOOKALIKES[k];
    if (certa && !keys.includes(certa)) avisos.push('"' + k + '" parece typo de "' + certa + '"');
    else if (certa) avisos.push('"' + k + '" está sobrando ao lado de "' + certa + '"');
  }
  return avisos;
}

const FM_SCHEMA_LABEL = { skill: 'skill', subagent: 'subagent', generico: 'genérico' };

const ICON_ALERTA = ['M12 9v4', 'M12 17h.01', 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'];

function fmWarnRow(msg) {
  const row = document.createElement('div');
  row.className = 'fm-warn';
  const ico = svgIcon(12, ICON_ALERTA);
  ico.classList.add('fm-warn-ico');
  const txt = document.createElement('span');
  txt.textContent = msg;
  row.appendChild(ico);
  row.appendChild(txt);
  return row;
}

// Valor do controle da linha, na forma que o fmSet espera.
function fmControlValue(input, kind) {
  if (kind === 'bool') return input.checked;
  if (kind === 'list') {
    return input.value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  return input.value;
}

// Reescreve a chave no bloco do documento. O bloco inteiro é re-emitido pelo
// serializador do yaml, mas ordem, comentários, chaves desconhecidas e mapas
// aninhados vêm do Document original: só o valor mexido muda.
function fmCommit(pane, key, kind, input) {
  if (!pane.vditor || !pane.ready) return;
  const texto = pane.vditor.getValue();
  const split = splitFrontmatter(texto);
  if (!split) return;
  const res = window.wired.fmSet(split.raw, key, kind, fmControlValue(input, kind));
  if (!res.ok) {
    renderFmWarnings(pane, ['não deu pra escrever no frontmatter: ' + res.error]);
    return;
  }
  const novo = '---\n' + res.raw + '\n---\n' + split.corpo;
  if (novo === texto) return;
  pane.fmQuiet = true; // a própria edição não deve refazer o painel
  pane.vditor.setValue(novo);
  setPaneDirty(pane, true);
  // Revalida sem redesenhar as linhas (o foco fica onde a pessoa está digitando).
  const parsed = window.wired.fmParse(res.raw);
  if (parsed.ok) renderFmWarnings(pane, fmValidate(fmSchema(pane.path, parsed.entries.map((e) => e.key)), parsed.entries));
  setTimeout(() => {
    pane.fmQuiet = false;
  }, 500);
}

function renderFmWarnings(pane, avisos) {
  const box = pane.fmEl.querySelector('.fm-warns');
  if (!box) return;
  box.innerHTML = '';
  for (const a of avisos) box.appendChild(fmWarnRow(a));
}

function fmRow(pane, entry) {
  const row = document.createElement('div');
  row.className = 'fm-row';
  const label = document.createElement('label');
  label.className = 'fm-key';
  label.textContent = entry.key;
  label.title = entry.key;
  row.appendChild(label);

  if (entry.kind === 'other') {
    // Mapa aninhado ou estrutura que o painel não representa: fica visível como
    // leitura e intocada no arquivo.
    const val = document.createElement('div');
    val.className = 'fm-val fm-other';
    val.textContent = entry.preview || '(estrutura preservada)';
    val.title = 'estrutura preservada como está no arquivo';
    row.appendChild(val);
    return row;
  }

  if (entry.kind === 'bool') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'fm-val fm-bool';
    cb.checked = !!entry.value;
    cb.addEventListener('change', () => fmCommit(pane, entry.key, 'bool', cb));
    row.appendChild(cb);
    return row;
  }

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'fm-val';
  inp.spellcheck = false;
  if (entry.kind === 'list') {
    inp.value = (entry.value || []).map((v) => (v === null ? '' : String(v))).join(', ');
    inp.placeholder = 'itens separados por vírgula';
  } else {
    inp.value = entry.value === null || entry.value === undefined ? '' : String(entry.value);
  }
  inp.dataset.key = entry.key;
  inp.addEventListener('change', () => fmCommit(pane, entry.key, entry.kind, inp));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fmCommit(pane, entry.key, entry.kind, inp);
    }
    e.stopPropagation();
  });
  row.appendChild(inp);
  return row;
}

function refreshFmPanel(pane) {
  if (!pane || !pane.fmEl) return;
  const el = pane.fmEl;
  el.innerHTML = '';
  const texto = pane.vditor && pane.ready ? pane.vditor.getValue() : '';
  const split = splitFrontmatter(texto);
  if (!split || config.frontmatterPanel === false) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  const parsed = window.wired.fmParse(split.raw);
  const entries = parsed.ok ? parsed.entries : [];
  const schema = fmSchema(pane.path, entries.map((e) => e.key));

  const head = document.createElement('div');
  head.className = 'fm-head';
  const titulo = document.createElement('span');
  titulo.className = 'fm-title';
  titulo.textContent = 'propriedades';
  const tag = document.createElement('span');
  tag.className = 'fm-schema';
  tag.textContent = FM_SCHEMA_LABEL[schema];
  tag.title = 'schema aplicado a este arquivo';
  head.appendChild(titulo);
  head.appendChild(tag);
  el.appendChild(head);

  const rows = document.createElement('div');
  rows.className = 'fm-rows';
  el.appendChild(rows);

  const warns = document.createElement('div');
  warns.className = 'fm-warns';
  el.appendChild(warns);

  // YAML inválido: o painel vira leitura crua com o erro do parser em cima.
  if (!parsed.ok || parsed.mapa === false) {
    const pre = document.createElement('pre');
    pre.className = 'fm-raw';
    pre.textContent = split.raw;
    rows.appendChild(pre);
    renderFmWarnings(pane, [parsed.ok ? 'o frontmatter não é um mapa de chaves; painel só de leitura' : 'YAML inválido: ' + parsed.error]);
    return;
  }

  if (entries.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'fm-empty';
    vazio.textContent = 'frontmatter vazio';
    rows.appendChild(vazio);
  }
  for (const e of entries) rows.appendChild(fmRow(pane, e));
  renderFmWarnings(pane, fmValidate(schema, entries));
}

function scheduleFmRefresh(pane) {
  if (pane.fmQuiet) return;
  clearTimeout(pane.fmTimer);
  pane.fmTimer = setTimeout(() => {
    // Não redesenha por baixo dos dedos de quem está digitando no painel.
    if (pane.fmEl && pane.fmEl.contains(document.activeElement)) return;
    refreshFmPanel(pane);
  }, 450);
}

function refreshAllFmPanels() {
  for (const p of panes) refreshFmPanel(p);
}

function toggleFrontmatterPanel(forceOn) {
  const on = forceOn === undefined ? config.frontmatterPanel === false : !!forceOn;
  config.frontmatterPanel = on;
  saveConfig();
  refreshAllFmPanels();
}

// ---------------------------------------------------------------------------
// modo foco e modo typewriter (a identidade de "editor pra escrever")
//
// FOCO: os blocos que não são o do caret esmaecem. A opacidade sai do
// --focus-dim do tema, medida pra o texto esmaecido nunca cair abaixo de 4.5:1
// (0.62 no wired = 4,66:1; 0.78 no claro = 4,91:1). Vale só no pane ATIVO: os
// outros seguem normais, senão o app inteiro apagaria.
//
// TYPEWRITER: a linha em edição fica no centro vertical do editor. A rolagem é
// atribuição direta de scrollTop no container do pane, com uma easing curta;
// scrollIntoView foi descartado porque ele rola TODOS os ancestrais roláveis, e
// aqui o ancestral é a tira horizontal dos panes (a tela andaria de lado).
//
// Os dois só reagem a caret e digitação (selectionchange e o input do Vditor).
// Nada acontece na roda do mouse nem na barra de rolagem: quem rola na mão fica
// onde parou até mexer o caret de novo.
// ---------------------------------------------------------------------------

function paneEditorRoot(pane) {
  return pane && pane.el ? pane.el.querySelector('.vditor-ir .vditor-reset') : null;
}

// Sobe do nó do caret até o filho DIRETO do .vditor-reset (o bloco de topo:
// parágrafo, título, lista inteira, tabela, imagem, cerca de código).
function topBlockOf(root, node) {
  let n = node;
  if (n && n.nodeType === 3) n = n.parentElement;
  while (n && n.parentElement && n.parentElement !== root) n = n.parentElement;
  return n && n.parentElement === root ? n : null;
}

function caretBlock(pane) {
  const root = paneEditorRoot(pane);
  if (!root) return null;
  const sel = window.getSelection ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
  if (!root.contains(sel.anchorNode)) return null;
  return topBlockOf(root, sel.anchorNode);
}

// Container que rola dentro do pane (o Vditor decide onde fica o overflow).
function scrollContainerOf(el, pane) {
  let n = el;
  while (n && n !== pane.el) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
    n = n.parentElement;
  }
  return null;
}

function clearFocusMarks(pane) {
  const root = paneEditorRoot(pane);
  if (!root) return;
  for (const el of Array.from(root.children)) el.classList.remove('focus-current');
}

function updateFocusMarker() {
  if (!config.focusMode) return;
  const pane = activePane();
  if (!pane) return;
  const root = paneEditorRoot(pane);
  if (!root) return;
  const bloco = caretBlock(pane);
  // Caret fora do editor (palette, painel de propriedades, terminal): o
  // marcador anterior fica onde está, senão o documento inteiro apagaria.
  if (!bloco) return;
  for (const el of Array.from(root.children)) el.classList.toggle('focus-current', el === bloco);
}

let twAnim = null;

// Easing curta (120ms) em cima de scrollTop: suave o bastante pra não pular,
// barata o bastante pra não brigar com quem digita rápido.
function easeScrollTop(cont, destino) {
  if (twAnim) cancelAnimationFrame(twAnim);
  const inicio = cont.scrollTop;
  const dist = destino - inicio;
  if (Math.abs(dist) < 1) {
    cont.scrollTop = destino;
    twAnim = null;
    return;
  }
  const t0 = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - t0) / 120);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    cont.scrollTop = inicio + dist * e;
    twAnim = k < 1 ? requestAnimationFrame(passo) : null;
  };
  twAnim = requestAnimationFrame(passo);
}

function centerCaretLine() {
  if (!config.typewriterMode) return;
  const pane = activePane();
  if (!pane) return;
  const bloco = caretBlock(pane);
  if (!bloco) return;
  const cont = scrollContainerOf(bloco, pane);
  if (!cont) return;
  let alvo = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    // Linha vazia devolve rect zerado: aí o bloco serve de referência.
    if (r && (r.height > 0 || r.top > 0)) alvo = r.top + r.height / 2;
  }
  if (alvo === null) {
    const rb = bloco.getBoundingClientRect();
    alvo = rb.top + rb.height / 2;
  }
  const rc = cont.getBoundingClientRect();
  const delta = alvo - (rc.top + rc.height / 2);
  if (Math.abs(delta) < 2) return;
  const max = Math.max(0, cont.scrollHeight - cont.clientHeight);
  easeScrollTop(cont, Math.max(0, Math.min(max, cont.scrollTop + delta)));
}

// Um quadro de espera junta a enxurrada de selectionchange que uma tecla gera.
let caretTick = null;
function caretMoved() {
  if (!config.focusMode && !config.typewriterMode) return;
  if (caretTick) return;
  caretTick = requestAnimationFrame(() => {
    caretTick = null;
    updateFocusMarker();
    centerCaretLine();
  });
}

document.addEventListener('selectionchange', caretMoved);

function applyFocusMode() {
  for (const p of panes) {
    const on = !!config.focusMode && p.id === activePaneId;
    p.el.classList.toggle('focus-mode', on);
    if (!on) clearFocusMarks(p);
  }
  updateFocusMarker();
}

function applyTypewriterMode() {
  for (const p of panes) p.el.classList.toggle('typewriter-mode', !!config.typewriterMode && p.id === activePaneId);
  centerCaretLine();
}

function toggleFocusMode(forceOn) {
  config.focusMode = forceOn === undefined ? !config.focusMode : !!forceOn;
  saveConfig();
  applyFocusMode();
}

function toggleTypewriterMode(forceOn) {
  config.typewriterMode = forceOn === undefined ? !config.typewriterMode : !!forceOn;
  saveConfig();
  applyTypewriterMode();
}

// ---------------------------------------------------------------------------
// command palette (Ctrl+Shift+P) e quick switcher (Ctrl+P)
// ---------------------------------------------------------------------------

const paletteOverlay = document.getElementById('palette-overlay');
const paletteInput = document.getElementById('palette-input');
const paletteList = document.getElementById('palette-list');

let paletteMode = null; // 'commands' | 'files'
let paletteItems = []; // itens filtrados na tela: { label, hint, run(ctrl) }
let paletteSel = 0;

const PALETTE_ACTIONS = [
  { label: 'alternar barra lateral', run: () => toggleSidebar() },
  { label: 'novo arquivo', hint: 'Ctrl+N', run: () => newFile() },
  { label: 'novo a partir de template', run: () => newFromTemplate() },
  { label: 'abrir arquivo', hint: 'Ctrl+O', run: () => openViaDialog(false) },
  { label: 'abrir arquivo ao lado', run: () => openViaDialog(true) },
  { label: 'salvar', hint: 'Ctrl+S', run: () => save() },
  { label: 'salvar como', hint: 'Ctrl+Shift+S', run: () => saveAs() },
  { label: 'buscar na pasta', hint: 'Ctrl+Shift+F', run: () => openSearch() },
  { label: 'propriedades: mostrar/ocultar', run: () => toggleFrontmatterPanel() },
  // Label como função: o rótulo diz o que o Enter vai fazer agora.
  { label: () => 'modo foco: ' + (config.focusMode ? 'desligar' : 'ligar'), hint: 'F8', run: () => toggleFocusMode() },
  { label: () => 'modo typewriter: ' + (config.typewriterMode ? 'desligar' : 'ligar'), hint: 'F9', run: () => toggleTypewriterMode() },
  { label: 'fechar painel atual', run: () => closeActivePane() },
  { label: 'alternar terminal', hint: 'Ctrl+`', run: () => toggleTerminal() },
  { label: 'terminal: ir pra pasta da nota (cd)', run: () => { toggleTerminal(true); setTimeout(cdTerminalToNote, 300); } },
  { label: 'mandar arquivo pro claude', run: () => sendFileToClaude() },
  { label: 'mandar seleção pro claude', run: () => sendSelectionToClaude() },
  { label: 'configurações', run: () => openSettings() }
];

// Fuzzy por subsequência: cada caractere da busca tem que aparecer em ordem.
// Pontua começo de palavra e sequências contíguas; menor distância ganha.
function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return -Infinity;
    if (idx === ti && qi > 0) {
      streak += 1;
      score += 3 + streak;
    } else {
      streak = 0;
      score += 1;
      if (idx === 0 || /[\s\-_./\\]/.test(t[idx - 1])) score += 3;
      score -= Math.min(idx - ti, 10) * 0.1;
    }
    ti = idx + 1;
  }
  score -= t.length * 0.01;
  return score;
}

function openPalette(mode) {
  paletteMode = mode;
  lastSelection = window.getSelection ? String(window.getSelection()).trim() : '';
  paletteInput.value = '';
  paletteInput.placeholder = mode === 'files' ? 'buscar arquivo... (Enter abre, Ctrl+Enter abre ao lado)' : 'buscar comando...';
  paletteOverlay.classList.remove('hidden');
  renderPalette();
  paletteInput.focus();
}

function closePalette() {
  paletteOverlay.classList.add('hidden');
  paletteMode = null;
}

function paletteSource() {
  if (paletteMode === 'files') {
    return treeFiles.map((f) => ({
      label: f.name,
      hint: f.path,
      run: (ctrl) => openPath(f.path, !!ctrl)
    }));
  }
  // O label pode ser função (ação de liga/desliga que mostra o estado atual).
  return PALETTE_ACTIONS.map((a) => ({ label: typeof a.label === 'function' ? a.label() : a.label, hint: a.hint || '', run: () => a.run() }));
}

function renderPalette() {
  const q = paletteInput.value.trim();
  const scored = [];
  for (const item of paletteSource()) {
    const s = fuzzyScore(q, item.label);
    if (s === -Infinity) continue;
    scored.push({ item, s });
  }
  scored.sort((a, b) => b.s - a.s);
  paletteItems = scored.slice(0, 30).map((x) => x.item);
  paletteSel = 0;
  paletteList.innerHTML = '';
  if (paletteItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = 'nada encontrado';
    paletteList.appendChild(empty);
    return;
  }
  paletteItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'palette-row' + (i === paletteSel ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'palette-label';
    label.textContent = item.label;
    row.appendChild(label);
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'palette-hint';
      hint.textContent = item.hint;
      row.appendChild(hint);
    }
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      runPaletteItem(item, e.ctrlKey);
    });
    paletteList.appendChild(row);
  });
}

function movePaletteSel(delta) {
  if (paletteItems.length === 0) return;
  paletteSel = (paletteSel + delta + paletteItems.length) % paletteItems.length;
  const rows = paletteList.querySelectorAll('.palette-row');
  rows.forEach((r, i) => r.classList.toggle('selected', i === paletteSel));
  const sel = rows[paletteSel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(item, ctrl) {
  closePalette();
  item.run(ctrl);
}

paletteInput.addEventListener('input', renderPalette);

paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    movePaletteSel(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    movePaletteSel(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = paletteItems[paletteSel];
    if (item) runPaletteItem(item, e.ctrlKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  }
});

paletteOverlay.addEventListener('mousedown', (e) => {
  if (e.target === paletteOverlay) closePalette();
});

// ---------------------------------------------------------------------------
// busca full-text na pasta da nota (Ctrl+Shift+F): o quick switcher acha por
// NOME, esta acha por CONTEÚDO. Resultados agrupados por arquivo; setas andam
// por todos os matches, Enter abre no pane ativo, Ctrl+Enter abre ao lado.
// ---------------------------------------------------------------------------

const searchOverlay = document.getElementById('search-overlay');
const searchInput = document.getElementById('search-input');
const searchStatus = document.getElementById('search-status');
const searchResults = document.getElementById('search-results');

const SEARCH_MIN_CHARS = 2;
let searchHits = []; // lista achatada dos matches na tela: { path, line, text, start, end }
let searchSel = 0;
let searchTimer = null;
let searchSeq = 0; // descarta resposta de busca velha que chega depois da nova

function openSearch() {
  if (!paletteOverlay.classList.contains('hidden')) closePalette();
  searchOverlay.classList.remove('hidden');
  searchInput.focus();
  searchInput.select();
  if (searchInput.value.trim().length >= SEARCH_MIN_CHARS) runSearch();
  else {
    searchStatus.textContent = 'digite pelo menos ' + SEARCH_MIN_CHARS + ' caracteres';
    searchResults.innerHTML = '';
    searchHits = [];
  }
}

function closeSearch() {
  searchOverlay.classList.add('hidden');
  clearTimeout(searchTimer);
}

async function runSearch() {
  const q = searchInput.value.trim();
  if (q.length < SEARCH_MIN_CHARS) {
    searchHits = [];
    searchResults.innerHTML = '';
    searchStatus.textContent = 'digite pelo menos ' + SEARCH_MIN_CHARS + ' caracteres';
    return;
  }
  if (!treeRoot) {
    searchStatus.textContent = 'nenhuma pasta aberta';
    return;
  }
  const seq = ++searchSeq;
  searchStatus.textContent = 'buscando em ' + baseName(treeRoot) + '...';
  const res = await window.wired.searchFolder(treeRoot, q);
  if (seq !== searchSeq) return; // chegou fora de ordem
  if (!res.ok) {
    searchStatus.textContent = 'a busca falhou: ' + (res.error || 'erro desconhecido');
    searchResults.innerHTML = '';
    searchHits = [];
    return;
  }
  renderSearch(res);
}

function renderSearch(res) {
  searchResults.innerHTML = '';
  searchHits = [];
  const files = res.files || [];
  const total = res.total || 0;
  if (files.length === 0) {
    searchStatus.textContent = 'nada encontrado em ' + baseName(treeRoot);
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'nada encontrado';
    searchResults.appendChild(empty);
    return;
  }
  searchStatus.textContent =
    total + (total === 1 ? ' resultado' : ' resultados') + ' em ' + files.length + (files.length === 1 ? ' arquivo' : ' arquivos') + (res.truncated ? ' (lista truncada)' : '');
  for (const f of files) {
    const head = document.createElement('div');
    head.className = 'search-file';
    head.title = f.path;
    const ico = svgIcon(12, ICON_FILE);
    ico.classList.add('tree-ico');
    const nome = document.createElement('span');
    nome.textContent = f.name;
    const cont = document.createElement('span');
    cont.className = 'search-file-count';
    cont.textContent = f.matches.length;
    head.appendChild(ico);
    head.appendChild(nome);
    head.appendChild(cont);
    searchResults.appendChild(head);
    for (const m of f.matches) {
      const hit = { path: f.path, line: m.line, text: m.text, start: m.start, end: m.end };
      const idx = searchHits.length;
      searchHits.push(hit);
      const row = document.createElement('div');
      row.className = 'search-line';
      const no = document.createElement('span');
      no.className = 'search-lineno';
      no.textContent = m.line;
      const txt = document.createElement('span');
      txt.className = 'search-text';
      txt.appendChild(document.createTextNode(m.text.slice(0, m.start)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = m.text.slice(m.start, m.end);
      txt.appendChild(mark);
      txt.appendChild(document.createTextNode(m.text.slice(m.end)));
      row.appendChild(no);
      row.appendChild(txt);
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        searchSel = idx;
        openSearchHit(hit, e.ctrlKey);
      });
      searchResults.appendChild(row);
    }
  }
  searchSel = 0;
  markSearchSel();
}

function searchRows() {
  return searchResults.querySelectorAll('.search-line');
}

function markSearchSel() {
  const rows = searchRows();
  rows.forEach((r, i) => r.classList.toggle('selected', i === searchSel));
  const sel = rows[searchSel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function moveSearchSel(delta) {
  if (searchHits.length === 0) return;
  searchSel = (searchSel + delta + searchHits.length) % searchHits.length;
  markSearchSel();
}

async function openSearchHit(hit, side) {
  closeSearch();
  await openPath(hit.path, !!side);
  jumpToText(hit.text.slice(hit.start, hit.end));
}

// Pulo até o trecho: MELHOR ESFORÇO, e a limitação é real. O Vditor em modo IR
// é WYSIWYG, então o que está na tela não é a linha do arquivo: sintaxe de
// tabela, link, título e código vira DOM diferente do texto bruto, e nem todo
// match do disco existe como texto contínuo no documento renderizado. Quando o
// trecho é achado, ele é selecionado e rolado até ficar visível; quando não é
// (ou quando cai dentro de marcação transformada), o arquivo simplesmente abre
// no topo, sem erro. Não existe API de "ir pra linha N" no Vditor IR.
function jumpToText(trecho) {
  const alvo = (trecho || '').trim();
  if (!alvo) return;
  setTimeout(() => {
    const pane = activePane();
    if (!pane || !pane.el) return;
    const raiz = pane.el.querySelector('.vditor-ir .vditor-reset');
    if (!raiz) return;
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.nodeValue.indexOf(alvo);
      if (i === -1) continue;
      try {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + alvo.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const el = node.parentElement;
        if (el) el.scrollIntoView({ block: 'center' });
      } catch {}
      return;
    }
  }, 260);
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSearchSel(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSearchSel(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const hit = searchHits[searchSel];
    if (hit) openSearchHit(hit, e.ctrlKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
  e.stopPropagation();
});

searchOverlay.addEventListener('mousedown', (e) => {
  if (e.target === searchOverlay) closeSearch();
});

// ---------------------------------------------------------------------------
// eventos globais
// ---------------------------------------------------------------------------

// --- sidebar: mostrar/ocultar e redimensionar (persistidos no config) ---

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;

function applySidebarState() {
  const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(config.sidebarWidth) || 240));
  sidebar.style.width = w + 'px';
  const visible = config.sidebarVisible !== false;
  sidebar.classList.toggle('hidden', !visible);
  sidebarResizer.classList.toggle('hidden', !visible);
}

function setSidebarVisible(v) {
  config.sidebarVisible = !!v;
  applySidebarState();
  saveConfig();
}

function toggleSidebar() {
  setSidebarVisible(sidebar.classList.contains('hidden'));
}

function setSidebarWidth(w) {
  config.sidebarWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w));
  applySidebarState();
}

let resizing = false;
sidebarResizer.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizing = true;
  document.body.classList.add('resizing-sidebar');
});
window.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  setSidebarWidth(e.clientX);
});
window.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  document.body.classList.remove('resizing-sidebar');
  saveConfig();
});

// ---------------------------------------------------------------------------
// barra de título custom: botões de ícone, controles de janela e maximizado
// ---------------------------------------------------------------------------

document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar);
document.getElementById('btn-terminal').addEventListener('click', () => toggleTerminal());
document.getElementById('btn-config').addEventListener('click', () => openSettings());

const winMaxBtn = document.getElementById('win-max');

function setMaxState(isMax) {
  winMaxBtn.classList.toggle('is-max', isMax);
  winMaxBtn.title = isMax ? 'Restaurar' : 'Maximizar';
}

document.getElementById('win-min').addEventListener('click', () => window.wired.winMinimize());
winMaxBtn.addEventListener('click', () => window.wired.winMaximizeToggle());
document.getElementById('win-close').addEventListener('click', () => window.wired.winClose());
window.wired.onMaximized((v) => setMaxState(v));
window.wired.winIsMaximized().then(setMaxState);

// Duplo clique na área de arrasto maximiza ou restaura, como no Windows.
document.getElementById('titlebar').addEventListener('dblclick', (e) => {
  if (e.target.closest('button, .menu-root, #titlebar-controls')) return;
  window.wired.winMaximizeToggle();
});

// Fase de captura: o Vditor consome keydown dentro do editor, então sem
// captura o Ctrl+S digitando no texto nunca chegaria aqui.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveAs();
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    newFile();
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    openViaDialog(false);
  }
  // Ctrl+P quick switcher, Ctrl+Shift+P command palette (estilo Obsidian).
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openPalette('files');
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openPalette('commands');
  }
  // Ctrl+Shift+F: busca full-text na pasta da nota (conteúdo, não nome).
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openSearch();
  }
  // Zoom da fonte do documento: Ctrl+= (ou Ctrl+Shift+=, que chega como +),
  // Ctrl+- diminui e Ctrl+0 volta ao padrão.
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    adjustFontZoom(1);
  }
  if (e.ctrlKey && (e.key === '-' || e.key === '_')) {
    e.preventDefault();
    adjustFontZoom(-1);
  }
  if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    setFontZoom(15);
  }
  // F8 e F9: modo foco e modo typewriter, os mesmos atalhos do Typora (e
  // nenhum dos dois estava em uso aqui).
  if (!e.ctrlKey && !e.altKey && e.key === 'F8') {
    e.preventDefault();
    toggleFocusMode();
  }
  if (!e.ctrlKey && !e.altKey && e.key === 'F9') {
    e.preventDefault();
    toggleTypewriterMode();
  }
  // Ctrl+` abre e fecha o terminal (em teclado ABNT pode chegar como aspas).
  if (e.ctrlKey && (e.key === '`' || e.key === "'" || e.code === 'Backquote')) {
    e.preventDefault();
    toggleTerminal();
  }
  if (e.key === 'Escape') {
    if (!ctxMenuEl.classList.contains('hidden')) hideCtxMenu();
    else if (!templateOverlay.classList.contains('hidden')) closeTemplatePicker(null);
    else if (!searchOverlay.classList.contains('hidden')) closeSearch();
    else if (!paletteOverlay.classList.contains('hidden')) closePalette();
    else if (!settingsOverlay.classList.contains('hidden')) closeSettings();
  }
}, true);

// --- zoom da fonte do documento (Ctrl+=/-/0 e Ctrl+scroll no editor):
// mexe no fontSize do config, com o clamp 11 a 26 do painel, e atualiza o
// campo do painel de configurações se ele estiver aberto. ---

function setFontZoom(v) {
  const size = Math.max(11, Math.min(26, Math.round(v)));
  config.fontSize = size;
  applyCustom();
  if (!settingsOverlay.classList.contains('hidden')) inpFontSize.value = size;
  saveConfig();
}

function adjustFontZoom(delta) {
  setFontZoom((Number(config.fontSize) || 15) + delta);
}

panesEl.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    adjustFontZoom(e.deltaY < 0 ? 1 : -1);
  },
  { passive: false }
);

window.wired.onOpenFilePath((p) => openPath(p, false));

// --- boot: cria o primeiro pane e aplica config salva ---

const firstPane = createPane();
activePaneId = firstPane.id;
firstPane.el.classList.add('active');

(async function boot() {
  try {
    config = Object.assign({}, config, await window.wired.getConfig());
  } catch {}
  await applyTheme(config.theme);
  await applySnippets();
  applySidebarState();
  renderRecents();
  updateSortTooltip();
  updateChrome();
  refreshAllFmPanels();
  applyFocusMode();
  applyTypewriterMode();
})();
