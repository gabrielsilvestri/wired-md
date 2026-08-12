// Renderer do wired-md: Vditor em modo IR (instant rendering), sidebar de
// arquivos, painel de configurações (tema, accent, fontes, snippets) e
// terminal embutido com xterm.js.

let vditor = null;
let currentPath = null;
let dirty = false;
let editorReady = false;
let pendingPath = null;

let config = {
  theme: 'wired',
  accent: null,
  fontBody: '',
  fontCode: '',
  fontSize: 15,
  snippets: []
};

const titlebarTitle = document.getElementById('titlebar-title');
const sidebar = document.getElementById('sidebar');
const fileListEl = document.getElementById('file-list');
const sidebarEmpty = document.getElementById('sidebar-empty');
const themeStyle = document.getElementById('theme-style');
const customStyle = document.getElementById('custom-style');

function baseName(p) {
  return p.split(/[\\/]/).pop();
}

function dirName(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}

function updateChrome() {
  const name = currentPath ? baseName(currentPath) : 'nenhum arquivo';
  titlebarTitle.textContent = (dirty ? '● ' : '') + name;
  titlebarTitle.title = currentPath || '';
  titlebarTitle.classList.toggle('dirty', dirty);
  window.wired.setTitle((dirty ? '● ' : '') + name + ' | wired-md');
}

function setDirty(v) {
  if (dirty === v) return;
  dirty = v;
  updateChrome();
}

async function refreshSidebar() {
  fileListEl.innerHTML = '';
  if (!currentPath) {
    sidebarEmpty.style.display = 'block';
    return;
  }
  const dir = dirName(currentPath);
  const res = await window.wired.listMd(dir);
  if (!res.ok || res.files.length === 0) {
    sidebarEmpty.style.display = 'block';
    return;
  }
  sidebarEmpty.style.display = 'none';
  for (const f of res.files) {
    const li = document.createElement('li');
    li.textContent = f.name;
    li.title = f.path;
    if (f.path === currentPath) li.classList.add('active');
    li.addEventListener('click', () => openPath(f.path));
    fileListEl.appendChild(li);
  }
}

async function openPath(p) {
  if (!editorReady) {
    pendingPath = p;
    return;
  }
  if (p === currentPath) return;
  if (dirty && !confirm('Há alterações não salvas. Descartar e abrir outro arquivo?')) return;
  const res = await window.wired.readFile(p);
  if (!res.ok) {
    alert('Não foi possível abrir o arquivo: ' + res.error);
    return;
  }
  currentPath = p;
  vditor.setValue(res.content);
  setDirty(false);
  updateChrome();
  refreshSidebar();
}

async function save() {
  if (!vditor) return;
  if (!currentPath) {
    saveAs();
    return;
  }
  const res = await window.wired.writeFile(currentPath, vditor.getValue());
  if (!res.ok) {
    alert('Falha ao salvar: ' + res.error);
    return;
  }
  setDirty(false);
}

async function saveAs() {
  if (!vditor) return;
  const p = await window.wired.saveAsDialog(currentPath);
  if (!p) return;
  const res = await window.wired.writeFile(p, vditor.getValue());
  if (!res.ok) {
    alert('Falha ao salvar: ' + res.error);
    return;
  }
  currentPath = p;
  setDirty(false);
  updateChrome();
  refreshSidebar();
}

function newFile() {
  if (!vditor) return;
  if (dirty && !confirm('Há alterações não salvas. Descartar e criar um novo arquivo?')) return;
  currentPath = null;
  vditor.setValue('');
  setDirty(false);
  updateChrome();
  refreshSidebar();
}

async function openViaDialog() {
  const p = await window.wired.openDialog();
  if (p) openPath(p);
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

// Digita o comando claude no shell, já com Enter.
document.getElementById('btn-claude').addEventListener('click', () => {
  toggleTerminal(true);
  setTimeout(() => {
    if (!termRunning) return;
    if (termKind === 'pty') {
      window.wired.termInput('claude\r');
    } else {
      xterm.write('claude\r\n');
      window.wired.termInput('claude\r\n');
      pipeLine = '';
    }
  }, 300);
});

// ---------------------------------------------------------------------------
// Vditor
// ---------------------------------------------------------------------------

vditor = new Vditor('editor', {
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
  input: () => setDirty(true),
  after: () => {
    editorReady = true;
    if (pendingPath) {
      const p = pendingPath;
      pendingPath = null;
      openPath(p);
    }
  }
});

// ---------------------------------------------------------------------------
// eventos globais
// ---------------------------------------------------------------------------

document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

// ---------------------------------------------------------------------------
// barra de título custom: menus, controles de janela e estado maximizado
// ---------------------------------------------------------------------------

const menuRoots = [...document.querySelectorAll('#titlebar .menu-root')];

function closeMenus() {
  for (const m of menuRoots) {
    m.querySelector('.menu-drop').classList.add('hidden');
    m.classList.remove('open');
  }
}

function anyMenuOpen() {
  return menuRoots.some((m) => m.classList.contains('open'));
}

for (const root of menuRoots) {
  const label = root.querySelector('.menu-label');
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    const drop = root.querySelector('.menu-drop');
    const willOpen = drop.classList.contains('hidden');
    closeMenus();
    if (willOpen) {
      drop.classList.remove('hidden');
      root.classList.add('open');
    }
  });
  // Com um menu aberto, passar o mouse troca de menu, como no menu nativo.
  label.addEventListener('mouseenter', () => {
    if (anyMenuOpen() && !root.classList.contains('open')) label.click();
  });
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-root')) closeMenus();
});

const MENU_ACTIONS = {
  novo: () => newFile(),
  abrir: () => openViaDialog(),
  salvar: () => save(),
  'salvar-como': () => saveAs(),
  sidebar: () => sidebar.classList.toggle('collapsed'),
  terminal: () => toggleTerminal(),
  config: () => openSettings()
};

for (const btn of document.querySelectorAll('.menu-drop button')) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenus();
    const fn = MENU_ACTIONS[btn.dataset.action];
    if (fn) fn();
  });
}

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
    openViaDialog();
  }
  if (e.key === 'Escape' && anyMenuOpen()) {
    closeMenus();
  }
  // Ctrl+` abre e fecha o terminal (em teclado ABNT pode chegar como aspas).
  if (e.ctrlKey && (e.key === '`' || e.key === "'" || e.code === 'Backquote')) {
    e.preventDefault();
    toggleTerminal();
  }
  if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) {
    closeSettings();
  }
}, true);

window.wired.onOpenFilePath((p) => openPath(p));

// --- boot: aplica config salva ---

(async function boot() {
  try {
    config = Object.assign({}, config, await window.wired.getConfig());
  } catch {}
  await applyTheme(config.theme);
  await applySnippets();
  updateChrome();
})();
