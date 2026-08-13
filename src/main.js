// Processo principal do wired-md.
// Cria a janela, resolve arquivo passado por linha de comando, expõe IPC de
// arquivo, de configuração (temas, snippets, config.json) e do terminal embutido.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;

// Nos modos de teste a janela costuma ficar COBERTA por outra (o terminal que
// dispara o teste), e aí o Chromium marca a janela como ocluída no Windows e
// para de renderizar: o viewport congela na última largura, as transições de
// CSS não avançam e qualquer medida de layout mente. Desligar a detecção de
// oclusão só nos testes deixa o app rodando de verdade mesmo atrás de outra
// janela. Em uso normal a detecção fica ligada (ela economiza bateria).
if (process.env.WIRED_E2E === '1' || process.env.WIRED_SMOKE === '1') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// --- pastas de dados do usuário (userData/themes, userData/snippets, config.json) ---

function userDir(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

const DEFAULT_CONFIG = {
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
  frontmatterPanel: true
};

function ensureUserDirs() {
  const themesDir = userDir('themes');
  const snippetsDir = userDir('snippets');
  const templatesDir = userDir('templates');
  fs.mkdirSync(themesDir, { recursive: true });
  fs.mkdirSync(snippetsDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  // Copia o que vem empacotado com o app (temas, snippets, templates) se ainda
  // não existir no userData. Arquivo já existente nunca é sobrescrito: o que o
  // usuário editou ou apagou é decisão dele.
  const pairs = [
    [path.join(__dirname, '..', 'themes'), themesDir, /\.css$/i],
    [path.join(__dirname, '..', 'snippets'), snippetsDir, /\.css$/i],
    [path.join(__dirname, '..', 'templates'), templatesDir, /\.(md|markdown)$/i]
  ];
  for (const [src, dest, ext] of pairs) {
    if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src)) {
      if (!ext.test(f)) continue;
      const target = path.join(dest, f);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(src, f), target);
    }
  }
}

function readConfig() {
  try {
    const raw = fs.readFileSync(userDir('config.json'), 'utf8');
    return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
  } catch {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(userDir('config.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

// Arquivo .md passado como argumento de linha de comando, se houver.
function fileFromArgv(argv) {
  const candidates = argv.slice(1).filter((a) => /\.(md|markdown)$/i.test(a));
  for (const c of candidates.reverse()) {
    const abs = path.resolve(c);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

// --- estado da janela (tamanho e posição persistem entre sessões) ---
// Padrão: bloquinho de texto vertical, 700x840, como o Notepad.

const DEFAULT_WIN = { width: 700, height: 840 };

function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(userDir('window-state.json'), 'utf8'));
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch {}
  return Object.assign({}, DEFAULT_WIN);
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const maximized = mainWindow.isMaximized();
    // Com a janela maximizada, guarda o tamanho normal (de restauração).
    const b = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    fs.writeFileSync(
      userDir('window-state.json'),
      JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }, null, 2),
      'utf8'
    );
  } catch {}
}

function createWindow() {
  const state = readWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: typeof state.x === 'number' ? state.x : undefined,
    y: typeof state.y === 'number' ? state.y : undefined,
    minWidth: 420,
    minHeight: 400,
    backgroundColor: '#101216',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Persiste tamanho e posição (debounce nos eventos contínuos).
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState();
  });

  // Estado maximizado vai pro renderer trocar o ícone maximizar/restaurar.
  mainWindow.on('maximize', () => sendWin('window:maximized', true));
  mainWindow.on('unmaximize', () => sendWin('window:maximized', false));

  mainWindow.webContents.on('did-finish-load', () => {
    const initial = fileFromArgv(process.argv);
    if (initial) {
      mainWindow.webContents.send('open-file-path', initial);
    }
    if (process.env.WIRED_SMOKE === '1') runSmokeTest();
    if (process.env.WIRED_E2E === '1') runE2eTest();
  });

  mainWindow.on('closed', () => {
    killTerminal();
    closeDirWatcher();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Janela 100% custom: nenhum menu nativo residual.
  Menu.setApplicationMenu(null);
  ensureUserDirs();
  createWindow();
});

// --- IPC de janela (barra de título custom) ---

function sendWin(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:isMaximized', () => (mainWindow ? mainWindow.isMaximized() : false));

app.on('window-all-closed', () => {
  killTerminal();
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC de arquivos ---

ipcMain.handle('dialog:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir markdown',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:saveAs', async (_ev, suggestedPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar como',
    defaultPath: suggestedPath || 'sem-título.md',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('file:read', async (_ev, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('file:write', async (_ev, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Árvore da pasta da nota aberta, para a sidebar: só .md/.markdown e
// subpastas que contenham algum (em qualquer nível).
const TREE_IGNORE = new Set(['node_modules', '.git', '.obsidian', '.trash']);

function buildTree(dir, depth) {
  if (depth > 8) return { dirs: [], files: [] };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { dirs: [], files: [] };
  }
  const dirs = [];
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || TREE_IGNORE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = buildTree(full, depth + 1);
      if (sub.dirs.length > 0 || sub.files.length > 0) {
        dirs.push({ name: e.name, path: full, dirs: sub.dirs, files: sub.files });
      }
    } else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) {
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {}
      files.push({ name: e.name, path: full, mtime });
    }
  }
  const cmp = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  dirs.sort(cmp);
  files.sort(cmp);
  return { dirs, files };
}

ipcMain.handle('dir:tree', async (_ev, root) => {
  try {
    if (!root || !fs.existsSync(root)) return { ok: false, error: 'pasta inexistente', tree: { dirs: [], files: [] } };
    return { ok: true, tree: buildTree(root, 0) };
  } catch (err) {
    return { ok: false, error: String(err.message || err), tree: { dirs: [], files: [] } };
  }
});

// fs.watch na pasta da nota: a sidebar se atualiza sozinha quando um arquivo
// novo aparece (debounce no main; o renderer só recebe 'dir:changed').
let dirWatcher = null;
let dirWatchTimer = null;

function closeDirWatcher() {
  clearTimeout(dirWatchTimer);
  if (dirWatcher) {
    try {
      dirWatcher.close();
    } catch {}
    dirWatcher = null;
  }
}

ipcMain.handle('dir:watch', (_ev, root) => {
  closeDirWatcher();
  if (!root || !fs.existsSync(root)) return { ok: false };
  try {
    dirWatcher = fs.watch(root, { recursive: true }, () => {
      clearTimeout(dirWatchTimer);
      dirWatchTimer = setTimeout(() => sendWin('dir:changed', root), 350);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// --- busca full-text na pasta da nota (Ctrl+Shift+F no renderer) ---
// Motor preferido: o binário do ripgrep que vem no pacote @vscode/ripgrep
// (offline, sem depender de rg instalado na máquina). O pacote em si é ESM e
// o main é CJS, então o binário é resolvido direto no subpacote da plataforma.
// Se ele não existir, cai num scan recursivo em Node puro (as pastas de notas
// aqui são pequenas, o custo é irrelevante).

const SEARCH_MAX = 200; // teto de matches devolvidos; acima disso vem truncado
const SEARCH_LINE_MAX = 240; // teto de caracteres da linha mostrada no resultado

// WIRED_SEARCH_ENGINE=node força o fallback (serve pra testar o caminho sem rg).
let rgPath = null;
try {
  if (process.env.WIRED_SEARCH_ENGINE === 'node') throw new Error('fallback forçado');
  const bin = process.platform === 'win32' ? 'rg.exe' : 'rg';
  rgPath = require.resolve('@vscode/ripgrep-' + process.platform + '-' + process.arch + '/bin/' + bin);
  if (!fs.existsSync(rgPath)) rgPath = null;
} catch {
  rgPath = null;
}
console.log('[wired-md] busca full-text: ' + (rgPath ? 'ripgrep (' + rgPath + ')' : 'scan em Node puro'));

// Recorta a linha em volta do match quando ela é longa demais pra caber na
// lista, mantendo o trecho destacado visível.
function windowLine(text, start, end) {
  if (text.length <= SEARCH_LINE_MAX) return { text, start, end };
  const folga = Math.max(0, Math.floor((SEARCH_LINE_MAX - (end - start)) / 2));
  let ini = Math.max(0, start - folga);
  let fim = Math.min(text.length, ini + SEARCH_LINE_MAX);
  ini = Math.max(0, fim - SEARCH_LINE_MAX);
  const prefixo = ini > 0 ? '...' : '';
  const sufixo = fim < text.length ? '...' : '';
  return {
    text: prefixo + text.slice(ini, fim) + sufixo,
    start: start - ini + prefixo.length,
    end: Math.min(end, fim) - ini + prefixo.length
  };
}

// Agrupa matches soltos por arquivo, na ordem em que apareceram.
function groupMatches(matches) {
  const byFile = new Map();
  for (const m of matches) {
    if (!byFile.has(m.path)) byFile.set(m.path, { path: m.path, name: path.basename(m.path), matches: [] });
    byFile.get(m.path).matches.push({ line: m.line, text: m.text, start: m.start, end: m.end });
  }
  // Ordem alfabética por caminho: o ripgrep varre em paralelo e devolve os
  // arquivos em ordem imprevisível, e lista que dança a cada busca confunde.
  return [...byFile.values()].sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
}

const SEARCH_GLOBS = ['-g', '*.md', '-g', '*.markdown', '-g', '!node_modules/**', '-g', '!.git/**', '-g', '!.obsidian/**', '-g', '!.trash/**'];

function searchWithRipgrep(root, query) {
  return new Promise((resolve) => {
    const args = ['--json', '--smart-case', '--fixed-strings', '--no-ignore', ...SEARCH_GLOBS, '--', query, '.'];
    const proc = spawn(rgPath, args, { cwd: root, windowsHide: true });
    const matches = [];
    let truncated = false;
    let resto = '';
    let morto = false;
    const finish = () => {
      if (morto) return;
      morto = true;
      resolve({ matches, truncated });
    };
    proc.stdout.on('data', (chunk) => {
      resto += chunk.toString('utf8');
      const linhas = resto.split('\n');
      resto = linhas.pop();
      for (const linha of linhas) {
        if (!linha.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(linha);
        } catch {
          continue;
        }
        if (ev.type !== 'match') continue;
        const abs = path.resolve(root, ev.data.path.text || '');
        const bruto = (ev.data.lines.text || '').replace(/\r?\n$/, '');
        const buf = Buffer.from(bruto, 'utf8');
        for (const sub of ev.data.submatches || []) {
          if (matches.length >= SEARCH_MAX) {
            truncated = true;
            try {
              proc.kill();
            } catch {}
            finish();
            return;
          }
          // rg dá offset em BYTES; a lista mostra caracteres, então converte
          // (linha em pt-BR com acento tem byte e caractere em contagens diferentes).
          const start = buf.slice(0, sub.start).toString('utf8').length;
          const end = buf.slice(0, sub.end).toString('utf8').length;
          const w = windowLine(bruto, start, end);
          matches.push({ path: abs, line: ev.data.line_number, text: w.text, start: w.start, end: w.end });
        }
      }
    });
    proc.on('error', () => {
      if (morto) return;
      morto = true;
      resolve(null); // motor quebrou: quem chamou cai no fallback
    });
    proc.on('close', finish);
  });
}

// Fallback em Node puro: mesma poda de pastas do file tree, busca literal
// sem diferenciar maiúscula de minúscula quando a query é toda minúscula.
function searchWithNode(root, query) {
  const matches = [];
  let truncated = false;
  const insensivel = query === query.toLowerCase();
  const alvo = insensivel ? query.toLowerCase() : query;
  const walk = (dir, depth) => {
    if (truncated || depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (truncated) return;
      if (e.name.startsWith('.') || TREE_IGNORE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(md|markdown)$/i.test(e.name)) continue;
      let conteudo;
      try {
        conteudo = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const linhas = conteudo.split(/\r?\n/);
      for (let i = 0; i < linhas.length; i++) {
        const bruto = linhas[i];
        const agulha = insensivel ? bruto.toLowerCase() : bruto;
        let de = agulha.indexOf(alvo);
        while (de !== -1) {
          if (matches.length >= SEARCH_MAX) {
            truncated = true;
            return;
          }
          const w = windowLine(bruto, de, de + query.length);
          matches.push({ path: full, line: i + 1, text: w.text, start: w.start, end: w.end });
          de = agulha.indexOf(alvo, de + query.length);
        }
      }
    }
  };
  walk(root, 0);
  return { matches, truncated };
}

ipcMain.handle('search:folder', async (_ev, root, query) => {
  try {
    const termo = String(query || '');
    if (!root || !fs.existsSync(root)) return { ok: false, error: 'pasta inexistente', files: [], total: 0 };
    if (termo.length < 2) return { ok: true, engine: 'nenhum', files: [], total: 0, truncated: false };
    let res = null;
    let engine = 'node';
    if (rgPath) {
      res = await searchWithRipgrep(root, termo);
      if (res) engine = 'ripgrep';
    }
    if (!res) res = searchWithNode(root, termo);
    return { ok: true, engine, files: groupMatches(res.matches), total: res.matches.length, truncated: res.truncated };
  } catch (err) {
    return { ok: false, error: String(err.message || err), files: [], total: 0 };
  }
});

// --- operações de arquivo da sidebar (toolbar e menu de contexto) ---

ipcMain.handle('fs:showInFolder', (_ev, p) => {
  try {
    if (fs.statSync(p).isDirectory()) shell.openPath(p);
    else shell.showItemInFolder(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('fs:createFile', (_ev, p) => {
  try {
    fs.writeFileSync(p, '', { flag: 'wx' });
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: err.code === 'EEXIST' ? 'já existe um arquivo com esse nome' : String(err.message || err) };
  }
});

ipcMain.handle('fs:createDir', (_ev, p) => {
  try {
    if (fs.existsSync(p)) return { ok: false, error: 'já existe uma pasta com esse nome' };
    fs.mkdirSync(p);
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('fs:rename', (_ev, from, to) => {
  try {
    if (fs.existsSync(to)) return { ok: false, error: 'já existe um item com esse nome' };
    fs.renameSync(from, to);
    return { ok: true, path: to };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Excluir manda pra lixeira do sistema (shell.trashItem), nunca unlink direto.
ipcMain.handle('fs:trash', async (_ev, p) => {
  try {
    await shell.trashItem(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Duplica o arquivo ao lado do original, com sufixo "copia" (numera se precisar).
ipcMain.handle('fs:duplicate', (_ev, p) => {
  try {
    const dir = path.dirname(p);
    const ext = path.extname(p);
    const base = path.basename(p, ext);
    let target = path.join(dir, base + ' copia' + ext);
    let n = 2;
    while (fs.existsSync(target)) {
      target = path.join(dir, base + ' copia ' + n + ext);
      n++;
    }
    fs.copyFileSync(p, target);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Exportar: dialog de salvar como e cópia do arquivo pra fora.
ipcMain.handle('fs:export', async (_ev, p) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar arquivo',
      defaultPath: path.basename(p),
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(p, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Atualiza o título da janela (nome do arquivo + indicador de modificado).
ipcMain.on('window:setTitle', (_ev, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});

// --- IPC de configuração, temas e snippets ---

ipcMain.handle('config:get', () => readConfig());

ipcMain.handle('config:set', (_ev, cfg) => {
  try {
    writeConfig(Object.assign({}, DEFAULT_CONFIG, cfg));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

function listCss(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.css'))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  } catch {
    return [];
  }
}

ipcMain.handle('themes:list', () => listCss(userDir('themes')).map((f) => f.replace(/\.css$/i, '')));

ipcMain.handle('themes:read', (_ev, name) => {
  try {
    // Só aceita nome simples, sem path traversal.
    if (!/^[\w\- .]+$/.test(name)) return { ok: false, error: 'nome inválido' };
    const css = fs.readFileSync(userDir('themes', name + '.css'), 'utf8');
    return { ok: true, css };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('snippets:list', () => listCss(userDir('snippets')));

ipcMain.handle('snippets:read', (_ev, file) => {
  try {
    if (!/^[\w\- .]+\.css$/i.test(file)) return { ok: false, error: 'nome inválido' };
    const css = fs.readFileSync(userDir('snippets', file), 'utf8');
    return { ok: true, css };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('snippets:openFolder', () => shell.openPath(userDir('snippets')));
ipcMain.handle('themes:openFolder', () => shell.openPath(userDir('themes')));

// --- templates (novo arquivo a partir de template, com variáveis) ---
// A pasta é relida a cada chamada de propósito: template que a pessoa larga em
// %APPDATA%\wired-md\templates\ com o app aberto aparece na próxima abertura do
// seletor, sem watcher e sem reiniciar.

const TEMPLATE_NAME_RE = /^[^\\/:*?"<>|]+\.(md|markdown)$/i;

ipcMain.handle('templates:list', () => {
  try {
    return fs
      .readdirSync(userDir('templates'))
      .filter((f) => /\.(md|markdown)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((f) => ({ file: f, name: f.replace(/\.(md|markdown)$/i, '') }));
  } catch {
    return [];
  }
});

ipcMain.handle('templates:read', (_ev, file) => {
  try {
    if (!TEMPLATE_NAME_RE.test(String(file || ''))) return { ok: false, error: 'nome inválido' };
    const content = fs.readFileSync(userDir('templates', file), 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('templates:openFolder', () => shell.openPath(userDir('templates')));

// --- terminal embutido ---
// Backend preferido: node-pty (terminal de verdade). Se a build nativa não
// carregar neste Electron, cai para child_process spawn do powershell com
// pipes, com o renderer fazendo eco local e edição de linha.

let nodePty = null;
let ptyLoadError = null;
try {
  nodePty = require('node-pty');
} catch (err) {
  ptyLoadError = String(err.message || err);
}
console.log(nodePty ? '[wired-md] terminal backend: node-pty' : '[wired-md] node-pty indisponível, fallback de pipes: ' + ptyLoadError);

let term = null; // { kind: 'pty' | 'pipe', proc, cwd }

function sendTerm(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function killTerminal() {
  if (!term) return;
  const t = term;
  term = null;
  try {
    if (t.kind === 'pty') t.proc.kill();
    else {
      // Mata a árvore inteira do powershell no Windows.
      spawn('taskkill', ['/pid', String(t.proc.pid), '/t', '/f'], { windowsHide: true });
    }
  } catch {}
}

function startPipeShell(cwd, cols, rows) {
  const proc = spawn('powershell.exe', ['-NoLogo'], {
    cwd,
    windowsHide: true,
    env: Object.assign({}, process.env, { TERM: 'dumb' }),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  proc.stdout.on('data', (d) => sendTerm('term:data', d.toString('utf8')));
  proc.stderr.on('data', (d) => sendTerm('term:data', d.toString('utf8')));
  proc.on('exit', (code) => {
    if (term && term.proc === proc) term = null;
    sendTerm('term:exit', code === null ? -1 : code);
  });
  return { kind: 'pipe', proc, cwd };
}

ipcMain.handle('term:start', (_ev, cwd, cols, rows) => {
  killTerminal();
  const dir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home');
  if (nodePty) {
    try {
      const proc = nodePty.spawn('powershell.exe', ['-NoLogo'], {
        name: 'xterm-256color',
        cols: cols || 100,
        rows: rows || 24,
        cwd: dir,
        env: process.env
      });
      proc.onData((d) => sendTerm('term:data', d));
      proc.onExit(({ exitCode }) => {
        if (term && term.proc === proc) term = null;
        sendTerm('term:exit', exitCode);
      });
      term = { kind: 'pty', proc, cwd: dir };
      return { ok: true, kind: 'pty', cwd: dir };
    } catch (err) {
      ptyLoadError = String(err.message || err);
    }
  }
  try {
    term = startPipeShell(dir, cols, rows);
    return { ok: true, kind: 'pipe', cwd: dir, ptyError: ptyLoadError };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.on('term:input', (_ev, data) => {
  if (!term) return;
  try {
    if (term.kind === 'pty') term.proc.write(data);
    else term.proc.stdin.write(data);
  } catch {}
});

// Interrompe o comando em execução. No pty é o Ctrl+C de verdade; no fallback
// de pipes não dá para mandar sinal, então mata o shell e sobe outro no mesmo cwd.
ipcMain.handle('term:interrupt', () => {
  if (!term) return { restarted: false };
  if (term.kind === 'pty') {
    try {
      term.proc.write('\x03');
    } catch {}
    return { restarted: false };
  }
  const cwd = term.cwd;
  killTerminal();
  term = startPipeShell(cwd);
  return { restarted: true };
});

ipcMain.on('term:resize', (_ev, cols, rows) => {
  if (term && term.kind === 'pty') {
    try {
      term.proc.resize(cols, rows);
    } catch {}
  }
});

ipcMain.handle('term:kill', () => {
  killTerminal();
  return { ok: true };
});

// --- teste ponta a ponta automatizado (WIRED_E2E=1): dirige o renderer de
// verdade, fluxo por fluxo, e imprime PASS/FAIL de cada um. Roda com o
// demo.md no argv: WIRED_E2E=1 npx electron . exemplos/demo.md ---

async function runE2eTest() {
  const js = (code) => mainWindow.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log('[e2e] ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + detail : ''));
  };
  const demoPath = fileFromArgv(process.argv);
  try {
    await sleep(3000);

    // 1. abrir arquivo do argv e render inline
    const opened = await js('currentPath');
    check('abrir demo.md via argv', !!opened && opened === demoPath, String(opened));
    const dom = await js(`(function(){var r=document.querySelector('.vditor-ir .vditor-reset');if(!r)return null;return {h1:!!r.querySelector('h1'),table:!!r.querySelector('table'),code:!!r.querySelector('pre'),quote:!!r.querySelector('blockquote'),task:!!r.querySelector('input[type=checkbox]')};})()`);
    check('render inline (h1, tabela, código, citação, tarefa)', !!dom && dom.h1 && dom.table && dom.code && dom.quote && dom.task, JSON.stringify(dom));

    // 2. sidebar em árvore listou a pasta e marcou o ativo
    const side = await js(`(function(){var a=document.querySelector('#file-tree .tree-row.file.active .tree-name');return {itens:document.querySelectorAll('#file-tree .tree-row').length,ativo:a?a.textContent:null};})()`);
    check('árvore da sidebar com item ativo', !!side && side.itens >= 1 && side.ativo === 'demo.md', JSON.stringify(side));

    // 3. editar com teclado de verdade e ver o estado sujo
    const original = fs.readFileSync(demoPath, 'utf8');
    mainWindow.focus();
    await js('vditor.focus()');
    await sleep(300);
    for (const ch of 'zeta42') {
      mainWindow.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await sleep(60);
    }
    await sleep(1500);
    const suja = await js('dirty');
    const titulo = mainWindow.getTitle();
    check('edição marca sujo e título ganha bolinha', suja === true && titulo.startsWith('● '), titulo);

    // 4. Ctrl+S de verdade (evento de teclado) e conteúdo em disco
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control'] });
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control'] });
    await sleep(900);
    const disco = fs.readFileSync(demoPath, 'utf8');
    const limpou = await js('dirty');
    check('Ctrl+S salvou em disco e limpou o sujo', disco.includes('zeta42') && limpou === false, 'dirty=' + limpou);

    // desfaz a edição no arquivo pra não sujar o repo
    fs.writeFileSync(demoPath, original, 'utf8');
    await js(`(function(){vditor.setValue(${JSON.stringify('PLACEHOLDER')});setDirty(false);})()`.replace('"PLACEHOLDER"', JSON.stringify(original)));
    check('conteúdo do demo restaurado', !fs.readFileSync(demoPath, 'utf8').includes('zeta42'));

    // 5. trocar tema pro claro
    await js(`(async()=>{config.theme='claro';await applyTheme('claro');})()`);
    await sleep(300);
    const bgClaro = await js(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`);
    check('tema claro aplicado', bgClaro === '#f2f0ea', bgClaro);

    // 6. accent custom com derivadas
    await js(`(function(){config.accent='#7a4fc7';applyCustom();})()`);
    const acc = await js(`(function(){var s=getComputedStyle(document.documentElement);return {a:s.getPropertyValue('--accent').trim(),soft:s.getPropertyValue('--accent-soft').trim()};})()`);
    check('accent custom e derivada soft', !!acc && acc.a === '#7a4fc7' && /^#/.test(acc.soft) && acc.soft !== acc.a, JSON.stringify(acc));

    // 7. snippet ligado injeta style
    await js(`(async()=>{config.snippets=['exemplo-titulos-sublinhados.css'];await applySnippets();})()`);
    await sleep(200);
    const nSnip = await js(`document.querySelectorAll('style[data-snippet]').length`);
    check('snippet CSS injetado', nSnip === 1, 'styles=' + nSnip);

    // volta pro tema wired antes do screenshot
    await js(`(async()=>{config.theme='wired';config.accent=null;config.snippets=[];await applyTheme('wired');await applySnippets();})()`);
    await sleep(300);

    // 8. terminal: abrir, esperar o prompt, rodar dir, ver a saída (com polling
    // porque o tempo de subida do shell varia de máquina pra máquina)
    await js('toggleTerminal(true)');
    const readBuf = () => js(`(function(){var out=[];for(var i=0;i<xterm.buffer.active.length;i++){var l=xterm.buffer.active.getLine(i);if(l)out.push(l.translateToString(true));}return out.join('\\n');})()`);
    let buf = '';
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      buf = await readBuf();
      if (/PS .*>/.test(buf)) break;
    }
    // O xterm quebra nomes no fim da linha (a largura do terminal depende da
    // sidebar), então o match ignora quebras e espaços.
    const temDemo = (s) => /demo\.md/.test(s.replace(/\s+/g, ''));
    await js(`window.wired.termInput('dir\\r')`);
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      buf = await readBuf();
      if (temDemo(buf)) break;
    }
    check('terminal (' + (term ? term.kind : 'nenhum') + ') rodou dir e listou demo.md', temDemo(buf), temDemo(buf) ? 'demo.md no buffer' : 'sem match');

    // 9. janela frameless com barra só de ícones
    const noMenu = Menu.getApplicationMenu() === null;
    const bar = await js(`(function(){var t=document.getElementById('titlebar');if(!t)return null;var enxuta=['btn-new','btn-open','btn-open-side','btn-save','btn-claude-file','btn-claude-sel'].every(function(id){return !document.getElementById(id);});return {drag:getComputedStyle(t).webkitAppRegion==='drag',controles:['win-min','win-max','win-close'].every(function(id){return !!document.getElementById(id);}),icones:['btn-toggle-sidebar','btn-terminal'].every(function(id){var b=document.getElementById(id);return !!b && !!b.querySelector('svg') && (b.title||'').length>0 && t.contains(b);}),config:(function(){var b=document.getElementById('btn-config');return !!b && !t.contains(b);})(),enxuta:enxuta,menusTexto:document.querySelectorAll('#titlebar .menu-root').length,titulo:(document.getElementById('titlebar-title')||{}).textContent||''};})()`);
    check('janela frameless: barra enxuta (sidebar, terminal), config no rodapé, claude fora da barra', noMenu && !!bar && bar.drag && bar.controles && bar.icones && bar.config && bar.enxuta && bar.menusTexto === 0 && bar.titulo.includes('demo.md'), JSON.stringify(bar));

    // 10. controles custom respondem: maximizar e restaurar via clique
    await js(`document.getElementById('win-max').click()`);
    await sleep(600);
    const maxOn = mainWindow.isMaximized();
    const iconRestaura = await js(`document.getElementById('win-max').classList.contains('is-max')`);
    await js(`document.getElementById('win-max').click()`);
    await sleep(600);
    const maxOff = mainWindow.isMaximized();
    check('controles custom: maximizar e restaurar respondem', maxOn && iconRestaura && !maxOff, 'max=' + maxOn + ' restaurado=' + !maxOff);

    // 10b. estado da janela persistido no userData
    await sleep(700);
    let winState = null;
    try {
      winState = JSON.parse(fs.readFileSync(userDir('window-state.json'), 'utf8'));
    } catch {}
    check('estado da janela salvo (window-state.json)', !!winState && typeof winState.width === 'number' && typeof winState.height === 'number', JSON.stringify(winState));

    // 11. árvore: subpasta nova aparece pelo fs.watch e expande no clique
    const subDir = path.join(path.dirname(demoPath), 'sub-e2e');
    const subFile = path.join(subDir, 'nota-e2e.md');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(subFile, '# nota e2e\n', 'utf8');
    await sleep(1500);
    const pastaNaArvore = await js(`(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.folder .tree-name')];return rows.some(function(n){return n.textContent==='sub-e2e';});})()`);
    const notaOculta = await js(`(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file .tree-name')];return !rows.some(function(n){return n.textContent==='nota-e2e.md'&&n.closest('.tree-children').style.display!=='none';});})()`);
    await js(`(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.folder')];var r=rows.find(function(x){return x.querySelector('.tree-name').textContent==='sub-e2e';});if(r)r.click();})()`);
    await sleep(300);
    const notaVisivel = await js(`(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file .tree-name')];var n=rows.find(function(x){return x.textContent==='nota-e2e.md';});return !!n && n.closest('.tree-children').style.display!=='none';})()`);
    check('árvore: pasta nova via fs.watch, fechada por padrão, expande no clique', pastaNaArvore && notaOculta && notaVisivel, 'pasta=' + pastaNaArvore + ' oculta=' + notaOculta + ' visivel=' + notaVisivel);

    // 12. recentes: abrir a nota da subpasta coloca ela no topo da lista
    await js(`(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file .tree-name')];var n=rows.find(function(x){return x.textContent==='nota-e2e.md';});if(n)n.closest('.tree-row').click();})()`);
    await sleep(600);
    const recentes = await js(`(function(){return [...document.querySelectorAll('#recent-list li')].map(function(l){return l.textContent;});})()`);
    check('recentes: nota aberta no topo e demo.md na lista', Array.isArray(recentes) && recentes[0] === 'nota-e2e.md' && recentes.includes('demo.md'), JSON.stringify(recentes));
    // volta pro demo e limpa o artefato de teste
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(600);
    fs.rmSync(subDir, { recursive: true, force: true });
    await js(`(function(){config.recentFiles=config.recentFiles.filter(function(p){return p.indexOf('nota-e2e')===-1;});saveConfig();renderRecents();})()`);
    await sleep(800);

    // 13. sidebar: redimensionar dentro dos limites e persistir no config
    await js(`setSidebarWidth(320); saveConfig();`);
    await sleep(200);
    const widthOk = await js(`(function(){return {css:document.getElementById('sidebar').style.width,cfg:config.sidebarWidth};})()`);
    const clampOk = await js(`(function(){setSidebarWidth(90);var min=document.getElementById('sidebar').style.width;setSidebarWidth(900);var max=document.getElementById('sidebar').style.width;setSidebarWidth(320);saveConfig();return {min:min,max:max};})()`);
    check('sidebar redimensiona com limites (180 a 480)', !!widthOk && widthOk.css === '320px' && widthOk.cfg === 320 && !!clampOk && clampOk.min === '180px' && clampOk.max === '480px', JSON.stringify({ widthOk, clampOk }));

    // 14. sidebar: ocultar e mostrar pelo botão de ícone, persistindo
    await js(`document.getElementById('btn-toggle-sidebar').click()`);
    await sleep(200);
    const oculta = await js(`(function(){return {hid:document.getElementById('sidebar').classList.contains('hidden'),cfg:config.sidebarVisible};})()`);
    await js(`document.getElementById('btn-toggle-sidebar').click()`);
    await sleep(200);
    const visivel = await js(`(function(){return {hid:document.getElementById('sidebar').classList.contains('hidden'),cfg:config.sidebarVisible};})()`);
    check('sidebar oculta e volta pelo botão, com persistência no config', oculta.hid && oculta.cfg === false && !visivel.hid && visivel.cfg === true, JSON.stringify({ oculta, visivel }));

    // 15. botão cd do terminal existe no painel
    const cdBtn = await js(`(function(){var b=document.getElementById('btn-term-cd');return !!b && !!b.querySelector('svg') && (b.title||'').length>0;})()`);
    check('botão cd no painel do terminal', cdBtn === true, String(cdBtn));

    // 16. sliding panes: abrir um segundo arquivo ao lado, ativo no novo pane
    const paneFile = path.join(path.dirname(demoPath), 'pane-e2e.md');
    fs.writeFileSync(paneFile, '# nota do pane e2e\n\ntexto de teste.\n', 'utf8');
    await sleep(1200); // fs.watch atualiza a árvore (e o quick switcher)
    await js(`openPath(${JSON.stringify(paneFile)}, true)`);
    await sleep(1500);
    const panes2 = await js(`(function(){var t=document.querySelector('#panes .pane.active .pane-title');return {n:panes.length,dom:document.querySelectorAll('#panes .pane').length,ativo:currentPath,titulo:t?t.textContent:null,single:document.getElementById('panes').classList.contains('single')};})()`);
    check('panes: segundo pane abre ao lado e fica ativo', !!panes2 && panes2.n === 2 && panes2.dom === 2 && panes2.ativo === paneFile && panes2.titulo === 'pane-e2e.md' && !panes2.single, JSON.stringify(panes2));

    // 17. panes: fechar o pane ativo volta pro primeiro (demo.md)
    await js(`document.querySelector('#panes .pane.active .pane-close').click()`);
    await sleep(600);
    const panes1 = await js(`(function(){return {n:panes.length,dom:document.querySelectorAll('#panes .pane').length,ativo:currentPath,single:document.getElementById('panes').classList.contains('single')};})()`);
    check('panes: fechar volta pra um pane com demo.md ativo', !!panes1 && panes1.n === 1 && panes1.dom === 1 && panes1.ativo === demoPath && panes1.single, JSON.stringify(panes1));

    // 18. command palette: abre, filtra e executa uma ação de verdade
    await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='barra lateral';i.dispatchEvent(new Event('input'));})()`);
    await sleep(200);
    const palSel = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
    await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(300);
    const palRes = await js(`(function(){return {fechou:document.getElementById('palette-overlay').classList.contains('hidden'),sidebarOculta:document.getElementById('sidebar').classList.contains('hidden')};})()`);
    await js(`toggleSidebar()`);
    await sleep(200);
    check('command palette filtra e executa (barra lateral)', palSel === 'alternar barra lateral' && !!palRes && palRes.fechou && palRes.sidebarOculta, JSON.stringify({ palSel, palRes }));

    // 19. quick switcher: acha o arquivo por fuzzy e Enter abre no pane ativo
    await js(`(function(){openPalette('files');var i=document.getElementById('palette-input');i.value='panee2e';i.dispatchEvent(new Event('input'));})()`);
    await sleep(200);
    const swSel = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
    await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(800);
    const swPath = await js('currentPath');
    check('quick switcher acha pane-e2e.md e abre', swSel === 'pane-e2e.md' && swPath === paneFile, JSON.stringify({ swSel, swPath }));
    // volta pro demo e limpa os artefatos
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(600);
    fs.rmSync(paneFile, { force: true });
    await js(`(function(){config.recentFiles=config.recentFiles.filter(function(p){return p.indexOf('pane-e2e')===-1;});saveConfig();renderRecents();})()`);
    await sleep(800);

    // 20. ponte claude por nota: sparkles no cabeçalho de cada pane e ações na palette
    const ponte = await js(`(function(){var todos=[...document.querySelectorAll('#panes .pane')];var okBtn=todos.length>0&&todos.every(function(p){var b=p.querySelector('.pane-header .pane-claude');return !!b&&!!b.querySelector('svg')&&(b.title||'').length>0;});var acoes=PALETTE_ACTIONS.map(function(a){return a.label;});return {okBtn:okBtn,semBarra:!document.getElementById('btn-claude-file')&&!document.getElementById('btn-claude-sel'),acaoFile:acoes.indexOf('mandar arquivo pro claude')!==-1,acaoSel:acoes.indexOf('mandar seleção pro claude')!==-1,acaoLado:acoes.indexOf('abrir arquivo ao lado')!==-1};})()`);
    check('ponte claude: sparkles no cabeçalho do pane (e fora da barra de título), ações na palette', !!ponte && ponte.okBtn && ponte.semBarra && ponte.acaoFile && ponte.acaoSel && ponte.acaoLado, JSON.stringify(ponte));

    // 22. cabeçalho da tree: nome da pasta raiz, tooltip com o path e botão do Explorer
    const rootDir = path.dirname(demoPath);
    const cab = await js(`(function(){var n=document.getElementById('sidebar-root-name');var b=document.getElementById('btn-root-explorer');return {nome:n?n.textContent:null,tip:n?n.title:null,btn:!!b&&!!b.querySelector('svg')&&(b.title||'').length>0};})()`);
    check('cabeçalho da sidebar: nome da raiz, tooltip e botão Explorer', !!cab && cab.nome === path.basename(rootDir) && cab.tip === rootDir && cab.btn, JSON.stringify(cab));

    // 23. toolbar da tree: os cinco botões de ícone com tooltip
    const tb = await js(`(function(){return ['btn-tree-new-file','btn-tree-template','btn-tree-new-folder','btn-tree-sort','btn-tree-collapse','btn-tree-search'].every(function(id){var b=document.getElementById(id);return !!b&&!!b.querySelector('svg')&&(b.title||'').length>0;});})()`);
    check('toolbar da tree: novo .md, template, nova pasta, ordenação, colapsar, busca', tb === true, String(tb));

    // 24. busca da tree: filtra por nome conforme digita e Esc limpa
    await js(`(function(){toggleTreeSearch(true);var i=document.getElementById('tree-search');i.value='anotac';i.dispatchEvent(new Event('input'));})()`);
    await sleep(250);
    const filtrado = await js(`(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file .tree-name')].map(function(n){return n.textContent;});return {rows:rows,soAnotacoes:rows.length>=1&&rows.every(function(n){return n.toLowerCase().indexOf('anotac')!==-1;})};})()`);
    await js(`document.getElementById('tree-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(250);
    const limpou2 = await js(`(function(){var rows=document.querySelectorAll('#file-tree .tree-row.file').length;return {oculto:document.getElementById('tree-search-wrap').classList.contains('hidden'),rows:rows};})()`);
    check('busca da tree filtra e Esc limpa', !!filtrado && filtrado.soAnotacoes && !!limpou2 && limpou2.oculto && limpou2.rows > filtrado.rows.length, JSON.stringify({ filtrado, limpou2 }));

    // 25. criar .md pela toolbar (dialog de nome do app) e abrir na hora
    const novoPath = path.join(rootDir, 'novo-e2e.md');
    await js('selectedDir = null'); // clique anterior apontava pra pasta já apagada
    await js(`document.getElementById('btn-tree-new-file').click()`);
    await sleep(300);
    const dlg = await js(`(function(){return !document.getElementById('input-overlay').classList.contains('hidden');})()`);
    await js(`(function(){var i=document.getElementById('input-field');i.value='novo-e2e.md';document.getElementById('input-ok').click();})()`);
    await sleep(900);
    const novoOk = await js('currentPath');
    check('toolbar cria .md e abre', dlg === true && fs.existsSync(novoPath) && novoOk === novoPath, JSON.stringify({ dlg, novoOk }));

    // 26. menu de contexto no arquivo da tree: abre e renomeia via dialog
    await js(`(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file')];var r=rows.find(function(x){return x.querySelector('.tree-name').textContent==='novo-e2e.md';});if(r)r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));})()`);
    await sleep(250);
    const menu = await js(`(function(){var m=document.getElementById('ctx-menu');if(m.classList.contains('hidden'))return null;return [...m.querySelectorAll('.ctx-item')].map(function(i){return i.textContent;});})()`);
    await js(`(function(){var it=[...document.querySelectorAll('#ctx-menu .ctx-item')].find(function(i){return i.textContent==='renomear';});if(it)it.click();})()`);
    await sleep(300);
    await js(`(function(){var i=document.getElementById('input-field');i.value='renomeado-e2e.md';document.getElementById('input-ok').click();})()`);
    await sleep(900);
    const renPath = path.join(rootDir, 'renomeado-e2e.md');
    const renomeou = fs.existsSync(renPath) && !fs.existsSync(novoPath);
    const renPane = await js('currentPath');
    check('menu de contexto abre e renomeia arquivo', Array.isArray(menu) && menu.includes('renomear') && menu.includes('excluir (lixeira)') && renomeou && renPane === renPath, JSON.stringify({ menu, renomeou, renPane }));
    // limpa o artefato e volta pro demo
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(600);
    fs.rmSync(renPath, { force: true });
    await js(`(function(){var p=activePane();var morto=panes.find(function(x){return x.path&&x.path.indexOf('renomeado-e2e')!==-1;});if(morto){setPaneDirty(morto,false);closePane(morto);}config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('novo-e2e')===-1&&r.indexOf('renomeado-e2e')===-1;});saveConfig();renderRecents();})()`);
    await sleep(800);

    // 27. ordenação: muda pelo menu do botão e persiste no config.json
    await js(`(function(){var b=document.getElementById('btn-tree-sort');b.click();})()`);
    await sleep(250);
    await js(`(function(){var it=[...document.querySelectorAll('#ctx-menu .ctx-item')].find(function(i){return i.textContent==='modificado primeiro';});if(it)it.click();})()`);
    await sleep(500);
    let cfgDisk = null;
    try {
      cfgDisk = JSON.parse(fs.readFileSync(userDir('config.json'), 'utf8'));
    } catch {}
    const sortCfg = await js('config.treeSort');
    await js(`setTreeSort('az')`);
    await sleep(300);
    check('ordenação muda pelo menu e persiste no config.json', sortCfg === 'recente' && !!cfgDisk && cfgDisk.treeSort === 'recente', JSON.stringify({ sortCfg, disk: cfgDisk && cfgDisk.treeSort }));

    // 28. sliding panes: em janela estreita, os panes inativos viram lombada
    // vertical (writing-mode vertical-rl) com X e título; só o ativo fica largo
    mainWindow.setSize(700, 840);
    await sleep(500);
    const spineA = path.join(path.dirname(demoPath), 'lombada-a-e2e.md');
    const spineB = path.join(path.dirname(demoPath), 'lombada-b-e2e.md');
    fs.writeFileSync(spineA, '# lombada a\n', 'utf8');
    fs.writeFileSync(spineB, '# lombada b\n', 'utf8');
    await sleep(1200);
    await js(`openPath(${JSON.stringify(spineA)}, true)`);
    await sleep(800);
    await js(`openPath(${JSON.stringify(spineB)}, true)`);
    await sleep(1000);
    const lomb = await js(`(function(){var todos=[...document.querySelectorAll('#panes .pane')];var col=todos.filter(function(p){return p.classList.contains('collapsed');});var ativo=document.querySelector('#panes .pane.active');var sp=col[0]?col[0].querySelector('.pane-spine'):null;var t=sp?sp.querySelector('.spine-title'):null;return {n:todos.length,col:col.length,ativoAberto:!!ativo&&!ativo.classList.contains('collapsed'),larguraLombada:col[0]?Math.round(col[0].getBoundingClientRect().width):0,vertical:t?getComputedStyle(t).writingMode:null,titulo:t?t.textContent:null,xNoTopo:sp?!!sp.querySelector('.spine-close'):false,dot:sp?!!sp.querySelector('.spine-dot'):false};})()`);
    check('lombada: janela estreita colapsa os inativos com título vertical, X e bolinha', !!lomb && lomb.n === 3 && lomb.col === 2 && lomb.ativoAberto && lomb.larguraLombada === 40 && lomb.vertical === 'vertical-rl' && !!lomb.titulo && lomb.xNoTopo && lomb.dot, JSON.stringify(lomb));

    // 29. clicar na lombada expande aquele pane e encolhe o anterior
    await js(`(function(){var todos=[...document.querySelectorAll('#panes .pane')];var alvo=todos.find(function(p){return p.classList.contains('collapsed')&&p.querySelector('.spine-title').textContent==='lombada-a-e2e.md';});if(alvo)alvo.querySelector('.pane-spine').dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);
    await sleep(700);
    const expandiu = await js(`(function(){var ativo=document.querySelector('#panes .pane.active');var col=document.querySelectorAll('#panes .pane.collapsed').length;return {ativo:currentPath,aberto:!!ativo&&!ativo.classList.contains('collapsed'),col:col};})()`);
    check('lombada expande no clique e o anterior encolhe', !!expandiu && expandiu.ativo === spineA && expandiu.aberto && expandiu.col === 2, JSON.stringify(expandiu));

    // 30. resize da janela recalcula o layout: larga abre todos, estreita volta
    // a colapsar (sidebar oculta pra régua ser só a área dos panes)
    await js('setSidebarVisible(false)');
    mainWindow.setSize(1500, 840);
    await sleep(700);
    const largo = await js(`document.querySelectorAll('#panes .pane.collapsed').length`);
    mainWindow.setSize(700, 840);
    await sleep(700);
    const estreito = await js(`document.querySelectorAll('#panes .pane.collapsed').length`);
    await js('setSidebarVisible(true)');
    check('resize recalcula: 1500px abre os 3 panes, 700px colapsa 2', largo === 0 && estreito === 2, 'largo=' + largo + ' estreito=' + estreito);
    // limpa: fecha os panes extras e apaga os artefatos
    await js(`(function(){['lombada-a-e2e','lombada-b-e2e'].forEach(function(k){var p=panes.find(function(x){return x.path&&x.path.indexOf(k)!==-1;});if(p){setPaneDirty(p,false);closePane(p);}});config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('lombada-')===-1;});saveConfig();renderRecents();})()`);
    await sleep(500);
    fs.rmSync(spineA, { force: true });
    fs.rmSync(spineB, { force: true });
    await sleep(800);

    // 31. terminal redimensionável: arrastar a borda superior muda a altura e persiste
    await js('toggleTerminal(true)');
    await sleep(600);
    const dragH = await js(`(function(){var panel=document.getElementById('terminal-panel');var r=panel.getBoundingClientRect();var res=document.getElementById('terminal-resizer');res.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientY:Math.round(r.top)}));window.dispatchEvent(new MouseEvent('mousemove',{clientY:Math.round(r.bottom-340)}));window.dispatchEvent(new MouseEvent('mouseup',{}));return {css:panel.style.height,cfg:config.terminalHeight};})()`);
    await sleep(500);
    let cfgTerm = null;
    try {
      cfgTerm = JSON.parse(fs.readFileSync(userDir('config.json'), 'utf8'));
    } catch {}
    const clampTerm = await js(`(function(){setTerminalHeight(50);var min=document.getElementById('terminal-panel').style.height;setTerminalHeight(9999);var max=parseInt(document.getElementById('terminal-panel').style.height,10);setTerminalHeight(260);saveConfig();return {min:min,maxOk:max<=Math.round(window.innerHeight*0.7)};})()`);
    await js('toggleTerminal(false)');
    check('terminal arrasta a altura (340px), persiste no config.json e respeita o clamp', !!dragH && dragH.css === '340px' && dragH.cfg === 340 && !!cfgTerm && cfgTerm.terminalHeight === 340 && !!clampTerm && clampTerm.min === '120px' && clampTerm.maxOk, JSON.stringify({ dragH, disk: cfgTerm && cfgTerm.terminalHeight, clampTerm }));

    // 32. zoom da fonte do documento: Ctrl+= sobe, Ctrl+0 volta pro padrão
    await js('setFontZoom(15)'); // ponto de partida determinístico
    await sleep(300);
    await js(`(function(){window.dispatchEvent(new KeyboardEvent('keydown',{key:'=',ctrlKey:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'=',ctrlKey:true}));})()`);
    await sleep(500);
    const zoomUp = await js(`(function(){return {cfg:config.fontSize,css:getComputedStyle(document.documentElement).getPropertyValue('--font-size-body').trim()};})()`);
    let cfgZoom = null;
    try {
      cfgZoom = JSON.parse(fs.readFileSync(userDir('config.json'), 'utf8'));
    } catch {}
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true}))`);
    await sleep(400);
    const zoomReset = await js('config.fontSize');
    check('zoom: Ctrl+= sobe a fonte pra 17 (persistida) e Ctrl+0 volta pra 15', !!zoomUp && zoomUp.cfg === 17 && zoomUp.css === '17px' && !!cfgZoom && cfgZoom.fontSize === 17 && zoomReset === 15, JSON.stringify({ zoomUp, disk: cfgZoom && cfgZoom.fontSize, zoomReset }));

    // 33. busca full-text: Ctrl+Shift+F de verdade abre o overlay
    const buscaA = path.join(path.dirname(demoPath), 'busca-a-e2e.md');
    const buscaB = path.join(path.dirname(demoPath), 'busca-b-e2e.md');
    fs.writeFileSync(buscaA, '# busca a\n\numa linha com zebrafone aqui\n\noutra com zebrafone de novo\n', 'utf8');
    fs.writeFileSync(buscaB, '# busca b\n\nsó uma zebrafone nesta\n', 'utf8');
    await sleep(1200); // fs.watch atualiza a árvore
    mainWindow.focus();
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control', 'shift'] });
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control', 'shift'] });
    await sleep(500);
    const buscaAberta = await js(`(function(){var o=document.getElementById('search-overlay');return {aberto:!o.classList.contains('hidden'),foco:document.activeElement&&document.activeElement.id==='search-input'};})()`);
    check('busca full-text: Ctrl+Shift+F abre o overlay com o campo focado', !!buscaAberta && buscaAberta.aberto && buscaAberta.foco, JSON.stringify(buscaAberta));

    // 34. digitar a query acha o termo nos dois arquivos, agrupado e contado
    await js(`(function(){var i=document.getElementById('search-input');i.value='zebrafone';i.dispatchEvent(new Event('input'));})()`);
    await sleep(1200);
    const buscaRes = await js(`(function(){var arquivos=[...document.querySelectorAll('#search-results .search-file')].map(function(f){return {nome:f.querySelector('span').textContent,n:f.querySelector('.search-file-count').textContent};});return {arquivos:arquivos,linhas:document.querySelectorAll('#search-results .search-line').length,status:document.getElementById('search-status').textContent,hits:searchHits.length};})()`);
    const nomesBusca = (buscaRes.arquivos || []).map((a) => a.nome).sort().join(',');
    check(
      'busca full-text acha o termo nos dois arquivos com a contagem certa (3 linhas)',
      !!buscaRes && buscaRes.linhas === 3 && buscaRes.hits === 3 && nomesBusca === 'busca-a-e2e.md,busca-b-e2e.md' && /3 resultados em 2 arquivos/.test(buscaRes.status),
      JSON.stringify(buscaRes)
    );

    // 35. o trecho encontrado sai destacado com o accent do tema
    const destaque = await js(`(function(){var m=document.querySelector('#search-results .search-line .search-hit');if(!m)return null;var c=getComputedStyle(m);return {texto:m.textContent,cor:c.color};})()`);
    check('busca full-text destaca o trecho na linha', !!destaque && destaque.texto === 'zebrafone', JSON.stringify(destaque));

    // 36. setas navegam entre os matches e Enter abre o arquivo do selecionado
    await js(`(function(){var i=document.getElementById('search-input');i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));})()`);
    await sleep(200);
    const sel = await js(`(function(){return {idx:searchSel,path:searchHits[searchSel]?searchHits[searchSel].path:null};})()`);
    await js(`document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(1200);
    const abriuBusca = await js('currentPath');
    check('busca full-text: setas andam nos matches e Enter abre o arquivo certo', !!sel && sel.idx === 2 && sel.path === buscaB && abriuBusca === buscaB, JSON.stringify({ sel, abriuBusca }));

    // 37. Esc fecha o overlay da busca
    await js(`openSearch()`);
    await sleep(300);
    const antesEsc = await js(`!document.getElementById('search-overlay').classList.contains('hidden')`);
    await js(`document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(300);
    const depoisEsc = await js(`document.getElementById('search-overlay').classList.contains('hidden')`);
    const acaoBusca = await js(`PALETTE_ACTIONS.map(function(a){return a.label;}).indexOf('buscar na pasta')!==-1`);
    check('busca full-text: Esc fecha e a palette tem a ação "buscar na pasta"', antesEsc === true && depoisEsc === true && acaoBusca === true, JSON.stringify({ antesEsc, depoisEsc, acaoBusca }));
    // limpa os artefatos da busca e volta pro demo
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(600);
    await js(`(function(){['busca-a-e2e','busca-b-e2e'].forEach(function(k){var p=panes.find(function(x){return x.path&&x.path.indexOf(k)!==-1;});if(p){setPaneDirty(p,false);closePane(p);}});config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('busca-')===-1;});saveConfig();renderRecents();})()`);
    await sleep(400);
    fs.rmSync(buscaA, { force: true });
    fs.rmSync(buscaB, { force: true });
    await sleep(800);

    // --- fase 8: painel de propriedades (frontmatter) ---

    // 38. painel aparece no arquivo com frontmatter (linhas certas, mapa
    // aninhado como preservado) e some no arquivo sem frontmatter
    const fmPath = path.join(path.dirname(demoPath), 'exemplo-skill.md');
    const fmOriginal = fs.readFileSync(fmPath, 'utf8');
    await js(`openPath(${JSON.stringify(fmPath)})`);
    await sleep(1200);
    const fmVisto = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');if(!p)return null;var linhas=[...p.querySelectorAll('.fm-row')].map(function(r){var i=r.querySelector('.fm-val');return {k:r.querySelector('.fm-key').textContent,tipo:i?i.className:null,v:i&&i.type==='checkbox'?i.checked:(i&&i.value!==undefined?i.value:(i?i.textContent:null))};});return {oculto:p.classList.contains('hidden'),schema:(p.querySelector('.fm-schema')||{}).textContent,linhas:linhas,avisos:p.querySelectorAll('.fm-warn').length};})()`);
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(900);
    const fmSemFm = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return {oculto:!p||p.classList.contains('hidden')};})()`);
    const fmChaves = (fmVisto && fmVisto.linhas || []).map((l) => l.k).join(',');
    const fmTools = (fmVisto && fmVisto.linhas || []).find((l) => l.k === 'tools');
    const fmBool = (fmVisto && fmVisto.linhas || []).find((l) => l.k === 'publicado');
    const fmMeta = (fmVisto && fmVisto.linhas || []).find((l) => l.k === 'meta');
    check(
      'propriedades: painel abre no arquivo com frontmatter (lista, booleano, mapa preservado) e some no arquivo sem',
      !!fmVisto && !fmVisto.oculto && fmChaves === 'name,description,tools,model,publicado,meta' && fmVisto.schema === 'subagent' &&
        !!fmTools && fmTools.v === 'Read, Write, Bash' && !!fmBool && fmBool.v === false && !!fmMeta && /fm-other/.test(fmMeta.tipo) &&
        fmVisto.avisos === 0 && fmSemFm.oculto,
      JSON.stringify({ fmChaves, schema: fmVisto && fmVisto.schema, semFm: fmSemFm })
    );

    // 39. editar no painel marca sujo e Ctrl+S grava o bloco reescrito em disco
    await js(`openPath(${JSON.stringify(fmPath)})`);
    await sleep(1000);
    await js(`(function(){var i=[...document.querySelectorAll('#panes .pane.active .fm-row input.fm-val')].find(function(x){return x.dataset.key==='description';});i.value='descrição trocada pelo e2e';i.dispatchEvent(new Event('change'));})()`);
    await sleep(700);
    const fmSujo = await js('dirty');
    mainWindow.focus();
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control'] });
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control'] });
    await sleep(1000);
    const fmDisco = fs.readFileSync(fmPath, 'utf8');
    const fmLimpo = await js('dirty');
    check(
      'propriedades: editar valor marca sujo e Ctrl+S grava o frontmatter em disco',
      fmSujo === true && fmLimpo === false && /description: descrição trocada pelo e2e/.test(fmDisco),
      'sujo=' + fmSujo + ' limpo=' + fmLimpo
    );

    // 40. round trip: chave aninhada desconhecida, comentário, ordem e corpo intactos
    check(
      'propriedades: round trip preserva mapa aninhado, comentário, ordem e corpo',
      /meta:\r?\n {2}autor: biel\r?\n {2}versao: 2/.test(fmDisco) &&
        /# comentário preservado no round trip/.test(fmDisco) &&
        /name: exemplo-skill[\s\S]*description:[\s\S]*tools:[\s\S]*model: sonnet/.test(fmDisco) &&
        /## quando usar/.test(fmDisco) && /- Read\r?\n {2}- Write\r?\n {2}- Bash/.test(fmDisco),
      JSON.stringify(fmDisco.slice(0, 260))
    );
    // restaura o fixture e o pane
    fs.writeFileSync(fmPath, fmOriginal, 'utf8');
    await js(`(function(){vditor.setValue(${JSON.stringify(fmOriginal)});setDirty(false);refreshFmPanel(activePane());})()`);
    await sleep(600);

    // 41. schema skill (arquivo SKILL.md): acusa description faltando e typo
    const skillDir = path.join(path.dirname(demoPath), 'skill-e2e');
    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillPath, '---\nname: skill-e2e\ndescribe: isto deveria ser description\n---\n# skill e2e\n', 'utf8');
    await sleep(1200);
    await js(`openPath(${JSON.stringify(skillPath)})`);
    await sleep(1200);
    const fmSkill = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');if(!p)return null;return {schema:(p.querySelector('.fm-schema')||{}).textContent,avisos:[...p.querySelectorAll('.fm-warn')].map(function(w){return w.textContent;})};})()`);
    const avisosSkill = (fmSkill && fmSkill.avisos) || [];
    check(
      'propriedades: schema skill acusa description faltando e chave parecida (describe)',
      !!fmSkill && fmSkill.schema === 'skill' && avisosSkill.some((a) => /falta a chave description/.test(a)) && avisosSkill.some((a) => /describe.*typo.*description/.test(a)),
      JSON.stringify(fmSkill)
    );

    // 42. YAML inválido: painel cai em leitura crua com o erro do parser
    const yamlRuim = path.join(skillDir, 'quebrado-e2e.md');
    fs.writeFileSync(yamlRuim, '---\nname: [isto nunca fecha\ndescription: oi\n---\n# quebrado\n', 'utf8');
    await sleep(1200);
    await js(`openPath(${JSON.stringify(yamlRuim)})`);
    await sleep(1200);
    const fmRuim = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');if(!p)return null;return {oculto:p.classList.contains('hidden'),raw:!!p.querySelector('.fm-raw'),campos:p.querySelectorAll('.fm-row input').length,avisos:[...p.querySelectorAll('.fm-warn')].map(function(w){return w.textContent;})};})()`);
    check(
      'propriedades: YAML inválido vira leitura crua com o erro do parser, sem campos editáveis',
      !!fmRuim && !fmRuim.oculto && fmRuim.raw && fmRuim.campos === 0 && (fmRuim.avisos || []).some((a) => /YAML inválido/.test(a)),
      JSON.stringify(fmRuim)
    );

    // 43. toggle pela palette oculta o painel e persiste no config.json
    await js(`openPath(${JSON.stringify(fmPath)})`);
    await sleep(1000);
    await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='propriedades';i.dispatchEvent(new Event('input'));})()`);
    await sleep(250);
    const fmSelPal = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
    await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(700);
    const fmDepoisToggle = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return {oculto:!p||p.classList.contains('hidden'),cfg:config.frontmatterPanel};})()`);
    let cfgFm = null;
    try {
      cfgFm = JSON.parse(fs.readFileSync(userDir('config.json'), 'utf8'));
    } catch {}
    await js('toggleFrontmatterPanel(true)');
    await sleep(600);
    const fmVoltou = await js(`(function(){var p=document.querySelector('#panes .pane.active .fm-panel');return !!p && !p.classList.contains('hidden');})()`);
    check(
      'propriedades: ação da palette oculta o painel, persiste no config.json e volta',
      fmSelPal === 'propriedades: mostrar/ocultar' && !!fmDepoisToggle && fmDepoisToggle.oculto && fmDepoisToggle.cfg === false && !!cfgFm && cfgFm.frontmatterPanel === false && fmVoltou === true,
      JSON.stringify({ fmSelPal, fmDepoisToggle, disk: cfgFm && cfgFm.frontmatterPanel, fmVoltou })
    );
    // limpa os artefatos da fase 8 e volta pro demo
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(600);
    await js(`(function(){['skill-e2e','quebrado-e2e','exemplo-skill'].forEach(function(k){var p=panes.find(function(x){return x.path&&x.path.indexOf(k)!==-1;});if(p){setPaneDirty(p,false);closePane(p);}});config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('skill-e2e')===-1&&r.indexOf('quebrado-e2e')===-1;});saveConfig();renderRecents();})()`);
    await sleep(500);
    fs.rmSync(skillDir, { recursive: true, force: true });
    fs.writeFileSync(fmPath, fmOriginal, 'utf8');
    await sleep(800);

    // --- fase 9: novo arquivo a partir de template (com variáveis) ---

    const tplDir = userDir('templates');
    const rootTpl = path.dirname(demoPath);
    await js('selectedDir = null'); // cliques anteriores apontavam pra pasta já apagada

    // 44. seletor abre pela ação da palette, lista os quatro templates semeados
    // e as setas andam na lista
    await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='template';i.dispatchEvent(new Event('input'));})()`);
    await sleep(250);
    const tplAcao = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
    await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(600);
    const tplLista = await js(`(function(){var o=document.getElementById('template-overlay');return {aberto:!o.classList.contains('hidden'),itens:[...document.querySelectorAll('#template-list .palette-row .palette-label')].map(function(l){return l.textContent;}),sel:(document.querySelector('#template-list .palette-row.selected .palette-label')||{}).textContent};})()`);
    await js(`(function(){window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'}));})()`);
    await sleep(200);
    const tplSel2 = await js(`(document.querySelector('#template-list .palette-row.selected .palette-label')||{}).textContent`);
    const tplNomes = ((tplLista && tplLista.itens) || []).slice().sort().join(',');
    check(
      'template: ação da palette abre o seletor com os quatro templates semeados e as setas navegam',
      tplAcao === 'novo a partir de template' && !!tplLista && tplLista.aberto && tplNomes === 'claude-md,nota,skill,subagent' && tplSel2 === 'skill',
      JSON.stringify({ tplAcao, tplLista, tplSel2 })
    );

    // 45. criar a partir de nota.md: variáveis resolvidas em disco, marcador de
    // cursor ausente e o arquivo aberto no pane ativo
    const notaTpl = path.join(rootTpl, 'nota-tpl-e2e.md');
    await js(`(function(){var rows=[...document.querySelectorAll('#template-list .palette-row')];var i=rows.findIndex(function(r){return r.querySelector('.palette-label').textContent==='nota';});templateSel=i;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`);
    await sleep(500);
    const tplPediuNome = await js(`(function(){return {aberto:!document.getElementById('input-overlay').classList.contains('hidden'),titulo:document.getElementById('input-title').textContent};})()`);
    await js(`(function(){var i=document.getElementById('input-field');i.value='nota-tpl-e2e.md';document.getElementById('input-ok').click();})()`);
    await sleep(1800);
    const notaDisco = fs.existsSync(notaTpl) ? fs.readFileSync(notaTpl, 'utf8') : '';
    const hojeE2e = new Date();
    const doisE2e = (n) => String(n).padStart(2, '0');
    const dataHojeE2e = hojeE2e.getFullYear() + '-' + doisE2e(hojeE2e.getMonth() + 1) + '-' + doisE2e(hojeE2e.getDate());
    const notaAberta = await js('currentPath');
    const caret = await js(`(function(){var ed=document.querySelector('#panes .pane.active .vditor-ir');var s=window.getSelection();return {dentro:!!ed&&!!s.anchorNode&&ed.contains(s.anchorNode),colapsado:s.isCollapsed};})()`);
    check(
      'template: nota.md resolve {{data}}, {{titulo}} e {{pasta}}, apaga o {{cursor}} e abre no pane ativo',
      notaDisco.indexOf('# nota-tpl-e2e') === 0 &&
        notaDisco.includes(dataHojeE2e) &&
        notaDisco.includes('em ' + path.basename(rootTpl) + '.') &&
        !/\{\{/.test(notaDisco) &&
        notaDisco.indexOf(String.fromCharCode(0xe000)) === -1 &&
        notaAberta === notaTpl &&
        !!tplPediuNome && tplPediuNome.aberto && /novo a partir de nota/.test(tplPediuNome.titulo) &&
        !!caret && caret.dentro,
      JSON.stringify({ notaDisco: notaDisco.slice(0, 120), notaAberta, caret, tplPediuNome })
    );

    // 46. template largado na pasta com o app aberto aparece no seletor, a
    // {{pergunta:...}} é feita no dialog do app e o marcador desconhecido sobra intacto
    const tplE2ePath = path.join(tplDir, 'e2e-template.md');
    fs.writeFileSync(
      tplE2ePath,
      '# {{titulo}}\n\nautor: {{pergunta:quem escreve}}\nrevisor: {{pergunta:quem escreve}}\nmarcador: {{coisa-que-o-app-nao-conhece}}\n\n{{cursor}}\n',
      'utf8'
    );
    const pergTpl = path.join(rootTpl, 'pergunta-tpl-e2e.md');
    await js(`void newFromTemplate()`);
    await sleep(700);
    const tplRelida = await js(`[...document.querySelectorAll('#template-list .palette-row .palette-label')].map(function(l){return l.textContent;})`);
    await js(`(function(){var rows=[...document.querySelectorAll('#template-list .palette-row')];var i=rows.findIndex(function(r){return r.querySelector('.palette-label').textContent==='e2e-template';});templateSel=i;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`);
    await sleep(500);
    await js(`(function(){var i=document.getElementById('input-field');i.value='pergunta-tpl-e2e.md';document.getElementById('input-ok').click();})()`);
    await sleep(600);
    const perguntou = await js(`(function(){return {aberto:!document.getElementById('input-overlay').classList.contains('hidden'),titulo:document.getElementById('input-title').textContent};})()`);
    await js(`(function(){var i=document.getElementById('input-field');i.value='fulano do e2e';document.getElementById('input-ok').click();})()`);
    await sleep(1800);
    const pergDisco = fs.existsSync(pergTpl) ? fs.readFileSync(pergTpl, 'utf8') : '';
    check(
      'template: pasta relida a quente, {{pergunta:...}} perguntada uma vez e substituída, marcador desconhecido intacto',
      Array.isArray(tplRelida) && tplRelida.indexOf('e2e-template') !== -1 &&
        !!perguntou && perguntou.aberto && perguntou.titulo === 'quem escreve' &&
        /autor: fulano do e2e/.test(pergDisco) && /revisor: fulano do e2e/.test(pergDisco) &&
        pergDisco.includes('{{coisa-que-o-app-nao-conhece}}') && !/\{\{cursor\}\}/.test(pergDisco),
      JSON.stringify({ tplRelida, perguntou, pergDisco: pergDisco.slice(0, 160) })
    );

    // 47. Esc no meio do fluxo (na pergunta) não deixa arquivo pela metade
    const abortTpl = path.join(rootTpl, 'abortado-tpl-e2e.md');
    await js(`void newFromTemplate()`);
    await sleep(700);
    await js(`(function(){var rows=[...document.querySelectorAll('#template-list .palette-row')];var i=rows.findIndex(function(r){return r.querySelector('.palette-label').textContent==='e2e-template';});templateSel=i;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));})()`);
    await sleep(500);
    await js(`(function(){var i=document.getElementById('input-field');i.value='abortado-tpl-e2e.md';document.getElementById('input-ok').click();})()`);
    await sleep(600);
    await js(`document.getElementById('input-field').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(900);
    const abortou = !fs.existsSync(abortTpl);
    const dialogoFechou = await js(`document.getElementById('input-overlay').classList.contains('hidden')`);
    // Esc no próprio seletor também cancela sem pedir nome
    await js(`void newFromTemplate()`);
    await sleep(700);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    await sleep(500);
    const seletorFechou = await js(`(function(){return {tpl:document.getElementById('template-overlay').classList.contains('hidden'),nome:document.getElementById('input-overlay').classList.contains('hidden')};})()`);
    check(
      'template: Esc na pergunta não cria arquivo nenhum e Esc no seletor cancela o fluxo',
      abortou && dialogoFechou === true && !!seletorFechou && seletorFechou.tpl && seletorFechou.nome,
      JSON.stringify({ abortou, dialogoFechou, seletorFechou })
    );

    // 48. entradas do fluxo: botão na toolbar da sidebar e item no menu de
    // contexto de pasta, vizinho do "novo arquivo .md aqui"
    const subTpl = path.join(rootTpl, 'sub-tpl-e2e');
    fs.mkdirSync(subTpl, { recursive: true });
    fs.writeFileSync(path.join(subTpl, 'nota.md'), '# sub tpl\n', 'utf8');
    await sleep(1400);
    await js(`(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.folder')];var r=rows.find(function(x){return x.querySelector('.tree-name').textContent==='sub-tpl-e2e';});if(r)r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));})()`);
    await sleep(300);
    const menuPasta = await js(`(function(){var m=document.getElementById('ctx-menu');if(m.classList.contains('hidden'))return null;return [...m.querySelectorAll('.ctx-item')].map(function(i){return i.textContent;});})()`);
    await js(`hideCtxMenu()`);
    const btnTpl = await js(`(function(){var b=document.getElementById('btn-tree-template');return !!b&&!!b.querySelector('svg')&&(b.title||'').length>0&&!!document.getElementById('tree-toolbar')&&document.getElementById('tree-toolbar').contains(b);})()`);
    check(
      'template: botão na toolbar da sidebar e item "novo a partir de template aqui" no menu de pasta',
      btnTpl === true && Array.isArray(menuPasta) && menuPasta.indexOf('novo a partir de template aqui') === menuPasta.indexOf('novo arquivo .md aqui') + 1,
      JSON.stringify({ btnTpl, menuPasta })
    );
    // limpa os artefatos da fase 9 e devolve a pasta de templates ao estado semeado
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(600);
    await js(`(function(){['nota-tpl-e2e','pergunta-tpl-e2e'].forEach(function(k){var p=panes.find(function(x){return x.path&&x.path.indexOf(k)!==-1;});if(p){setPaneDirty(p,false);closePane(p);}});config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('-tpl-e2e')===-1;});saveConfig();renderRecents();})()`);
    await sleep(400);
    fs.rmSync(notaTpl, { force: true });
    fs.rmSync(pergTpl, { force: true });
    fs.rmSync(tplE2ePath, { force: true });
    fs.rmSync(subTpl, { recursive: true, force: true });
    await sleep(900);

    // --- fase 10: modo foco e modo typewriter ---

    const rootFoco = path.dirname(demoPath);
    const selEditor = '#panes .pane.active .vditor-ir .vditor-reset';

    // 49. ação da palette liga o modo foco, com o rótulo mostrando o estado
    // atual, e o config.json registra. Os dois modos são zerados antes: o
    // config real do usuário pode ter qualquer um deles ligado, e aí o rótulo
    // viria "desligar" e o Enter desligaria em vez de ligar (mesma razão do
    // setFontZoom(15) no check do zoom).
    await js('toggleFocusMode(false)');
    await js('toggleTypewriterMode(false)');
    await sleep(300);
    await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='modo foco';i.dispatchEvent(new Event('input'));})()`);
    await sleep(250);
    const focoLabel = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
    await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(700);
    let cfgFoco = null;
    try {
      cfgFoco = JSON.parse(fs.readFileSync(userDir('config.json'), 'utf8'));
    } catch {}
    const focoEstado = await js(`(function(){var p=document.querySelector('#panes .pane.active');return {cfg:config.focusMode,classe:!!p&&p.classList.contains('focus-mode')};})()`);
    check(
      'foco: ação da palette liga o modo (rótulo com o estado) e o config.json registra',
      focoLabel === 'modo foco: ligar' && !!focoEstado && focoEstado.cfg === true && focoEstado.classe && !!cfgFoco && cfgFoco.focusMode === true,
      JSON.stringify({ focoLabel, focoEstado, disk: cfgFoco && cfgFoco.focusMode })
    );

    // 50. o bloco do caret ganha a marca e os irmãos esmaecem na opacidade
    // medida do tema (0.62 no wired, 4,66:1 de contraste no texto esmaecido)
    await js(`(function(){var root=document.querySelector('${selEditor}');var kids=[...root.children];var r=document.createRange();r.selectNodeContents(kids[1]);r.collapse(true);var s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);
    await sleep(600);
    const focoMarca = await js(`(function(){var root=document.querySelector('${selEditor}');var kids=[...root.children];var idx=kids.findIndex(function(k){return k.classList.contains('focus-current');});var marcados=kids.filter(function(k){return k.classList.contains('focus-current');}).length;var outro=kids[idx===0?1:0];return {n:kids.length,idx:idx,marcados:marcados,opAtual:getComputedStyle(kids[idx]).opacity,opOutro:getComputedStyle(outro).opacity,varTema:getComputedStyle(document.documentElement).getPropertyValue('--focus-dim').trim()};})()`);
    // a opacidade é MEDIDA por tema, não chutada: focusDimFor devolve a menor
    // opacidade que ainda deixa a tinta esmaecida acima do piso de contraste.
    // A conta é pura, então roda direto na paleta do tema claro (bg #f2f0ea,
    // ink #3c424a), sem trocar o tema ativo (troca ao vivo aqui era flaky).
    const dimClaro = await js(`String(focusDimFor('#f2f0ea','#3c424a'))`);
    check(
      'foco: o bloco do caret é o único marcado, os irmãos ficam na opacidade medida (0.62 no wired, 0.76 no claro)',
      !!focoMarca && focoMarca.n > 2 && focoMarca.idx === 1 && focoMarca.marcados === 1 && focoMarca.opAtual === '1' && Math.abs(Number(focoMarca.opOutro) - 0.62) < 0.02 && focoMarca.varTema === '0.62' && dimClaro === '0.76',
      JSON.stringify({ focoMarca, dimClaro })
    );

    // 51. mover o caret pra outro bloco move a marca junto
    await js(`(function(){var root=document.querySelector('${selEditor}');var kids=[...root.children];var r=document.createRange();r.selectNodeContents(kids[2]);r.collapse(true);var s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);
    await sleep(500);
    const focoMoveu = await js(`(function(){var root=document.querySelector('${selEditor}');var kids=[...root.children];return {idx:kids.findIndex(function(k){return k.classList.contains('focus-current');}),marcados:kids.filter(function(k){return k.classList.contains('focus-current');}).length,opAntigo:getComputedStyle(kids[1]).opacity};})()`);
    check(
      'foco: o caret em outro bloco leva a marca junto e o anterior esmaece',
      !!focoMoveu && focoMoveu.idx === 2 && focoMoveu.marcados === 1 && Math.abs(Number(focoMoveu.opAntigo) - 0.62) < 0.02,
      JSON.stringify(focoMoveu)
    );

    // 52. typewriter: digitando na última linha de um arquivo longo, o bloco do
    // caret fica no centro vertical do container que rola. O arquivo abre num
    // pane novo, o que também prova que o pane INATIVO não esmaece nem centra.
    const longoPath = path.join(rootFoco, 'foco-e2e.md');
    const linhas = [];
    for (let i = 1; i <= 90; i++) linhas.push('linha ' + i + ' do teste de typewriter.');
    fs.writeFileSync(longoPath, '# foco e2e\n\n' + linhas.join('\n\n') + '\n', 'utf8');
    await sleep(1300);
    await js(`openPath(${JSON.stringify(longoPath)}, true)`);
    await sleep(1600);
    await js('toggleTypewriterMode(true)');
    await sleep(400);
    mainWindow.focus();
    // vditor.focus() põe o caret no COMEÇO do documento: pra testar a última
    // linha, a range vai pro fim do último bloco na mão.
    await js('vditor.focus()');
    await sleep(300);
    await js(`(function(){var root=document.querySelector('${selEditor}');var kids=[...root.children];var r=document.createRange();r.selectNodeContents(kids[kids.length-1]);r.collapse(false);var s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await sleep(400);
    for (const ch of 'zz') {
      mainWindow.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await sleep(80);
    }
    await sleep(1200);
    const tw = await js(`(function(){var p=activePane();var b=caretBlock(p);if(!b)return {erro:'sem bloco'};var c=scrollContainerOf(b,p);if(!c)return {erro:'sem container'};var rb=b.getBoundingClientRect(),rc=c.getBoundingClientRect();var inativos=panes.filter(function(x){return x.id!==p.id;});return {delta:Math.round(Math.abs((rb.top+rb.height/2)-(rc.top+rc.height/2))),alturaCont:Math.round(rc.height),scroll:Math.round(c.scrollTop),classe:p.el.classList.contains('typewriter-mode'),nPanes:panes.length,inativoFoco:inativos.some(function(x){return x.el.classList.contains('focus-mode');}),inativoTw:inativos.some(function(x){return x.el.classList.contains('typewriter-mode');})};})()`);
    check(
      'typewriter: digitar na última linha mantém o bloco no centro vertical do pane, e o pane inativo fica normal',
      !!tw && !tw.erro && tw.classe && tw.nPanes === 2 && tw.scroll > 0 && tw.delta <= 40 && !tw.inativoFoco && !tw.inativoTw,
      JSON.stringify(tw)
    );

    // 53. os dois toggles são independentes, e os atalhos F8 e F9 respondem
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'F8'}))`);
    await sleep(500);
    const soTw = await js(`(function(){var p=document.querySelector('#panes .pane.active');return {foco:config.focusMode,tw:config.typewriterMode,cFoco:p.classList.contains('focus-mode'),cTw:p.classList.contains('typewriter-mode')};})()`);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'F9'}))`);
    await sleep(300);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'F8'}))`);
    await sleep(500);
    const soFoco = await js(`(function(){var p=document.querySelector('#panes .pane.active');return {foco:config.focusMode,tw:config.typewriterMode,cFoco:p.classList.contains('focus-mode'),cTw:p.classList.contains('typewriter-mode')};})()`);
    check(
      'foco e typewriter: independentes um do outro, e F8 e F9 ligam e desligam cada um',
      !!soTw && soTw.foco === false && soTw.tw === true && !soTw.cFoco && soTw.cTw &&
        !!soFoco && soFoco.foco === true && soFoco.tw === false && soFoco.cFoco && !soFoco.cTw,
      JSON.stringify({ soTw, soFoco })
    );

    // 54. desligar os dois volta o documento ao normal (sem marca, opacidade
    // cheia em todo bloco) e o config.json fica com os dois em false
    await js('toggleFocusMode(false)');
    await sleep(600);
    let cfgDesligado = null;
    try {
      cfgDesligado = JSON.parse(fs.readFileSync(userDir('config.json'), 'utf8'));
    } catch {}
    const normal = await js(`(function(){var p=document.querySelector('#panes .pane.active');var root=document.querySelector('${selEditor}');var kids=[...root.children];return {marcados:kids.filter(function(k){return k.classList.contains('focus-current');}).length,opacidades:[...new Set(kids.map(function(k){return getComputedStyle(k).opacity;}))],cFoco:p.classList.contains('focus-mode'),cTw:p.classList.contains('typewriter-mode'),cfg:[config.focusMode,config.typewriterMode]};})()`);
    check(
      'foco e typewriter desligados: nenhuma marca, opacidade cheia em todo bloco e config.json com os dois em false',
      !!normal && normal.marcados === 0 && normal.opacidades.length === 1 && normal.opacidades[0] === '1' && !normal.cFoco && !normal.cTw &&
        normal.cfg[0] === false && normal.cfg[1] === false && !!cfgDesligado && cfgDesligado.focusMode === false && cfgDesligado.typewriterMode === false,
      JSON.stringify({ normal, disk: cfgDesligado && [cfgDesligado.focusMode, cfgDesligado.typewriterMode] })
    );
    // limpa o artefato da fase 10 e volta pro demo
    await js(`(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf('foco-e2e')!==-1;});if(p){setPaneDirty(p,false);closePane(p);}config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('foco-e2e')===-1;});saveConfig();renderRecents();})()`);
    await sleep(500);
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(600);
    fs.rmSync(longoPath, { force: true });
    await sleep(900);

    // 55. dinheiro não vira fórmula: cifrão é cifrão, math inline está
    // desligado no lute e o texto sobrevive ao round trip
    const dinheiroPath = path.join(path.dirname(demoPath), 'dinheiro-e2e.md');
    const dinheiroTxt = 'Preço de R$297 a R$ 397, e o plano B custa R$ 2.997.\n\nO Tabari cobra R$ 62 e o Biel R$ 1.200 por mês.\n';
    fs.writeFileSync(dinheiroPath, dinheiroTxt, 'utf8');
    await js(`openPath(${JSON.stringify(dinheiroPath)})`);
    await sleep(1200);
    const grana = await js(`(function(){var root=document.querySelector('${selEditor}');if(!root)return null;return {math:root.querySelectorAll('[data-type="math-inline"], code.language-math, .katex, .vditor-math').length,texto:root.textContent.replace(/\\s+/g,' ').trim(),valor:vditor.getValue()};})()`);
    check(
      'R$ não vira fórmula (math inline desligado) e o texto sobrevive ao round trip',
      !!grana && grana.math === 0 &&
        grana.texto.indexOf('R$297 a R$ 397') !== -1 && grana.texto.indexOf('R$ 2.997') !== -1 &&
        grana.valor.replace(/\s+/g, ' ').trim() === dinheiroTxt.replace(/\s+/g, ' ').trim(),
      JSON.stringify(grana)
    );
    await js(`(function(){var p=panes.find(function(x){return x.path&&x.path.indexOf('dinheiro-e2e')!==-1;});if(p){setPaneDirty(p,false);closePane(p);}config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('dinheiro-e2e')===-1;});saveConfig();renderRecents();})()`);
    await sleep(400);
    await js(`openPath(${JSON.stringify(demoPath)})`);
    await sleep(600);
    fs.rmSync(dinheiroPath, { force: true });
    await sleep(700);

    // 56. contraste do destaque de busca e do aviso de schema fica na faixa
    // 4.5:1 a 11:1 nos DOIS temas (piso do astigmatismo do dono). Conta pura
    // sobre os arquivos de tema do repo, com composição de alpha no destaque
    // (accent a 0.18 sobre a linha); sem troca de tema ao vivo, que era flaky.
    const contraste = (function () {
      const lum = (r, g, b) => {
        const c = [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const rat = (a, b) => { const la = lum.apply(null, a), lb = lum.apply(null, b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
      const hex = (s) => { const n = parseInt(s.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
      const comp = (fg, a, bg) => fg.map((v, i) => v * a + bg[i] * (1 - a));
      const leVars = (txt) => { const o = {}; const re = /--([\w-]+)\s*:\s*([^;]+);/g; let m; while ((m = re.exec(txt))) o[m[1]] = m[2].trim(); return o; };
      const medir = (file) => {
        const v = leVars(fs.readFileSync(path.join(__dirname, '..', 'themes', file), 'utf8'));
        const rgb = v['accent-rgb'].split(',').map(Number);
        const ink = hex(v['search-hit-ink']);
        const bg2 = hex(v['bg-2']);
        const bg3 = hex(v['bg-3']);
        return { shBg2: rat(ink, comp(rgb, 0.18, bg2)), shBg3: rat(ink, comp(rgb, 0.18, bg3)), warn: rat(hex(v['warn-ink']), bg2) };
      };
      return { wired: medir('wired.css'), claro: medir('claro.css') };
    })();
    const naFaixa = (x) => x >= 4.5 && x <= 11;
    const todosContraste = [contraste.wired.shBg2, contraste.wired.shBg3, contraste.wired.warn, contraste.claro.shBg2, contraste.claro.shBg3, contraste.claro.warn];
    check(
      'contraste do destaque de busca e do aviso de schema fica em 4.5:1 a 11:1 nos dois temas',
      todosContraste.every(naFaixa),
      JSON.stringify(contraste)
    );

    // 21. screenshot final: janela larga, sidebar visível e três panes (a
    // régua com a sidebar de 320px deixa dois abertos e um em lombada)
    await js('toggleTerminal(false)');
    mainWindow.setSize(1360, 840);
    mainWindow.center();
    const notasPath = path.join(path.dirname(demoPath), 'anotacoes.md');
    // o terceiro pane é o exemplo com frontmatter, pra o painel de propriedades
    // aparecer no screenshot
    await js(`openPath(${JSON.stringify(notasPath)}, true)`);
    await sleep(1000);
    await js(`openPath(${JSON.stringify(fmPath)}, true)`);
    await sleep(1500);
    const img = await mainWindow.webContents.capturePage();
    const docsDir = path.join(__dirname, '..', 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'screenshot.png'), img.toPNG());
    check('screenshot salvo em docs/screenshot.png', fs.existsSync(path.join(docsDir, 'screenshot.png')));
  } catch (err) {
    check('e2e sem exceção', false, err.message);
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log('[e2e] total=' + results.length + ' falhas=' + fails);
  app.exit(fails === 0 ? 0 : 1);
}

// --- smoke test automatizado (WIRED_SMOKE=1): abre o terminal, roda um echo
// e loga o que o xterm mostrou, para verificação sem interação manual. ---

async function runSmokeTest() {
  const js = (code) => mainWindow.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await sleep(2500);
    await js('toggleTerminal(true)');
    await sleep(3000);
    await js(`window.wired.termInput('echo oi_wired_' + (40+2) + '\\r')`);
    await sleep(2500);
    const buf = await js(`(function(){var out=[];for(var i=0;i<xterm.buffer.active.length;i++){var l=xterm.buffer.active.getLine(i);if(l)out.push(l.translateToString(true));}return out.join('\\n');})()`);
    console.log('[smoke] backend=' + (term ? term.kind : 'nenhum'));
    console.log('[smoke] buffer:\n' + buf);
    console.log('[smoke] echo ok: ' + /oi_wired_42/.test(buf.replace(/echo oi_wired_.*42/g, (m) => m)));
    const cfg = await js('JSON.stringify(config)');
    console.log('[smoke] config: ' + cfg);
    const temas = await js(`window.wired.listThemes()`);
    console.log('[smoke] temas: ' + JSON.stringify(temas));
    if (process.env.WIRED_SMOKE_SET === '1') {
      await js(`(async()=>{config.theme='claro';config.accent='#7a4fc7';config.fontSize=17;config.snippets=['exemplo-titulos-sublinhados.css'];await applyTheme('claro');await applySnippets();await saveConfig();})()`);
      await sleep(800);
    }
    const estado = await js(`JSON.stringify({bg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),fs:getComputedStyle(document.documentElement).getPropertyValue('--font-size-body').trim(),snips:document.querySelectorAll('style[data-snippet]').length})`);
    console.log('[smoke] estado visual: ' + estado);
  } catch (err) {
    console.log('[smoke] falhou: ' + err.message);
  }
  app.quit();
}
