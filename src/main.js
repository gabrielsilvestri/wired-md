// Processo principal do wired-md.
// Cria a janela, resolve arquivo passado por linha de comando, expõe IPC de
// arquivo, de configuração (temas, snippets, config.json) e do terminal embutido.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;

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
  recentFiles: []
};

function ensureUserDirs() {
  const themesDir = userDir('themes');
  const snippetsDir = userDir('snippets');
  fs.mkdirSync(themesDir, { recursive: true });
  fs.mkdirSync(snippetsDir, { recursive: true });
  // Copia os temas padrão empacotados com o app se ainda não existirem no userData.
  const pairs = [
    [path.join(__dirname, '..', 'themes'), themesDir],
    [path.join(__dirname, '..', 'snippets'), snippetsDir]
  ];
  for (const [src, dest] of pairs) {
    if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src)) {
      if (!f.endsWith('.css')) continue;
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
    defaultPath: suggestedPath || 'sem-titulo.md',
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
      files.push({ name: e.name, path: full });
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
    const bar = await js(`(function(){var t=document.getElementById('titlebar');if(!t)return null;return {drag:getComputedStyle(t).webkitAppRegion==='drag',controles:['win-min','win-max','win-close'].every(function(id){return !!document.getElementById(id);}),icones:['btn-toggle-sidebar','btn-new','btn-open','btn-save','btn-terminal','btn-config'].every(function(id){var b=document.getElementById(id);return !!b && !!b.querySelector('svg') && (b.title||'').length>0;}),menusTexto:document.querySelectorAll('#titlebar .menu-root').length,titulo:(document.getElementById('titlebar-title')||{}).textContent||''};})()`);
    check('janela frameless: sem menu nativo, barra arrastável, controles e botões de ícone com tooltip', noMenu && !!bar && bar.drag && bar.controles && bar.icones && bar.menusTexto === 0 && bar.titulo.includes('demo.md'), JSON.stringify(bar));

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

    // 16. screenshot final
    await js('toggleTerminal(false)');
    await sleep(400);
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
