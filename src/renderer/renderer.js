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
  recentFiles: []
};

const titlebarTitle = document.getElementById('titlebar-title');
const sidebar = document.getElementById('sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const fileTreeEl = document.getElementById('file-tree');
const recentListEl = document.getElementById('recent-list');
const recentSection = document.getElementById('recent-section');
const sidebarEmpty = document.getElementById('sidebar-empty');
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
      markdown: { toc: true, mark: true }
    },
    placeholder: 'abra um arquivo .md ou comece a escrever...',
    input: () => setPaneDirty(pane, true),
    after: () => {
      pane.ready = true;
      if (pane.pendingPath) {
        const p = pane.pendingPath;
        pane.pendingPath = null;
        openInPane(pane, p);
      }
    }
  };
}

function updatePanesLayout() {
  panesEl.classList.toggle('single', panes.length === 1);
}

function paneTitleText(pane) {
  return pane.path ? baseName(pane.path) : 'sem título';
}

function updatePaneHeader(pane) {
  pane.titleEl.textContent = (pane.dirty ? '● ' : '') + paneTitleText(pane);
  pane.titleEl.title = pane.path || '';
  pane.titleEl.classList.toggle('dirty', pane.dirty);
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
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-close';
  closeBtn.title = 'Fechar painel';
  closeBtn.setAttribute('aria-label', 'Fechar painel');
  closeBtn.appendChild(svgIcon(12, ICON_X));
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const edEl = document.createElement('div');
  edEl.className = 'pane-editor';
  edEl.id = 'pane-ed-' + id;

  el.appendChild(header);
  el.appendChild(edEl);
  panesEl.appendChild(el);

  const pane = { id, el, titleEl, path: null, dirty: false, vditor: null, ready: false, pendingPath: null };
  pane.vditor = new Vditor(edEl.id, vditorOptions(pane));

  el.addEventListener('mousedown', () => setActivePane(pane));
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePane(pane);
  });

  panes.push(pane);
  updatePanesLayout();
  updatePaneHeader(pane);
  return pane;
}

function setActivePane(pane) {
  if (!pane || activePaneId === pane.id) return;
  activePaneId = pane.id;
  for (const p of panes) p.el.classList.toggle('active', p.id === pane.id);
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
  row.addEventListener('click', (e) => openPath(f.path, e.ctrlKey));
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
    const open = expandedDirs.has(d.path);
    row.classList.toggle('open', open);
    children.style.display = open ? '' : 'none';
    row.addEventListener('click', () => {
      if (expandedDirs.has(d.path)) expandedDirs.delete(d.path);
      else expandedDirs.add(d.path);
      const nowOpen = expandedDirs.has(d.path);
      row.classList.toggle('open', nowOpen);
      children.style.display = nowOpen ? '' : 'none';
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

async function refreshSidebar() {
  fileTreeEl.innerHTML = '';
  renderRecents();
  const p = activePane();
  const cur = p ? p.path : null;
  if (!cur) {
    sidebarEmpty.style.display = 'block';
    return;
  }
  const dir = dirName(cur);
  if (dir !== treeRoot) {
    treeRoot = dir;
    expandedDirs.clear();
    // Subpastas nascem fechadas quando a raiz muda; abrir é um clique.
    window.wired.watchDir(dir);
  }
  const res = await window.wired.dirTree(dir);
  const tree = res.tree || { dirs: [], files: [] };
  treeFiles = flattenTree(tree, []);
  if (!res.ok || (tree.dirs.length === 0 && tree.files.length === 0)) {
    sidebarEmpty.style.display = 'block';
    return;
  }
  sidebarEmpty.style.display = 'none';
  renderTreeLevel(fileTreeEl, tree, 0);
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
    recentListEl.appendChild(li);
  }
}

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
// ponte claude: manda o arquivo (path) ou a seleção como contexto pro claude,
// digitando o comando no terminal embutido, na pasta da nota. Sem API.
// ---------------------------------------------------------------------------

// Literal de string do PowerShell entre aspas simples (aspa simples dobrada).
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// Abre o terminal, espera o shell subir, faz cd pra pasta da nota e digita o comando.
function runInNoteTerminal(cmd) {
  toggleTerminal(true);
  const dir = currentPath ? dirName(currentPath) : null;
  const started = Date.now();
  const tick = () => {
    if (!termRunning) {
      if (Date.now() - started < 8000) setTimeout(tick, 200);
      return;
    }
    if (dir) {
      termType('cd "' + dir + '"');
      terminalCwd.textContent = dir;
    }
    setTimeout(() => termType(cmd), 200);
  };
  setTimeout(tick, 300);
}

function sendFileToClaude() {
  if (!currentPath) {
    alert('Nenhum arquivo aberto para mandar pro claude.');
    return;
  }
  const prompt = 'leia o arquivo "' + currentPath + '" como contexto e me ajude com ele';
  runInNoteTerminal('claude ' + psQuote(prompt));
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
  const prompt = 'sobre este trecho da minha nota: "' + compact + '"';
  runInNoteTerminal('claude ' + psQuote(prompt));
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
  { label: 'abrir arquivo', hint: 'Ctrl+O', run: () => openViaDialog(false) },
  { label: 'abrir arquivo ao lado', run: () => openViaDialog(true) },
  { label: 'salvar', hint: 'Ctrl+S', run: () => save() },
  { label: 'salvar como', hint: 'Ctrl+Shift+S', run: () => saveAs() },
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
  return PALETTE_ACTIONS.map((a) => ({ label: a.label, hint: a.hint || '', run: () => a.run() }));
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
document.getElementById('btn-new').addEventListener('click', () => newFile());
document.getElementById('btn-open').addEventListener('click', () => openViaDialog(false));
document.getElementById('btn-open-side').addEventListener('click', () => openViaDialog(true));
document.getElementById('btn-save').addEventListener('click', () => save());
document.getElementById('btn-terminal').addEventListener('click', () => toggleTerminal());
document.getElementById('btn-claude-file').addEventListener('click', () => sendFileToClaude());
document.getElementById('btn-claude-sel').addEventListener('click', () => sendSelectionToClaude());
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
  // Ctrl+` abre e fecha o terminal (em teclado ABNT pode chegar como aspas).
  if (e.ctrlKey && (e.key === '`' || e.key === "'" || e.code === 'Backquote')) {
    e.preventDefault();
    toggleTerminal();
  }
  if (e.key === 'Escape') {
    if (!paletteOverlay.classList.contains('hidden')) closePalette();
    else if (!settingsOverlay.classList.contains('hidden')) closeSettings();
  }
}, true);

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
  updateChrome();
})();
