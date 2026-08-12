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
  snippets: []
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

// Lista os .md da pasta do arquivo aberto, para a sidebar.
ipcMain.handle('dir:listMd', async (_ev, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
      .map((e) => ({ name: e.name, path: path.join(dirPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return { ok: true, files };
  } catch (err) {
    return { ok: false, error: String(err.message || err), files: [] };
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

    // 2. sidebar listou a pasta e marcou o ativo
    const side = await js(`(function(){var a=document.querySelector('#file-list li.active');return {itens:document.querySelectorAll('#file-list li').length,ativo:a?a.textContent:null};})()`);
    check('sidebar com item ativo', !!side && side.itens >= 1 && side.ativo === 'demo.md', JSON.stringify(side));

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

    // 8. terminal: abrir, rodar dir, ver a saída
    await js('toggleTerminal(true)');
    await sleep(3500);
    await js(`window.wired.termInput('dir\\r')`);
    await sleep(2500);
    const buf = await js(`(function(){var out=[];for(var i=0;i<xterm.buffer.active.length;i++){var l=xterm.buffer.active.getLine(i);if(l)out.push(l.translateToString(true));}return out.join('\\n');})()`);
    check('terminal (' + (term ? term.kind : 'nenhum') + ') rodou dir e listou demo.md', /demo\.md/.test(buf), (buf.match(/demo\.md.*/) || ['sem match'])[0].trim());

    // 9. janela frameless com barra de título custom
    const noMenu = Menu.getApplicationMenu() === null;
    const bar = await js(`(function(){var t=document.getElementById('titlebar');if(!t)return null;return {drag:getComputedStyle(t).webkitAppRegion==='drag',controles:['win-min','win-max','win-close'].every(function(id){return !!document.getElementById(id);}),menus:document.querySelectorAll('#titlebar .menu-root').length,titulo:(document.getElementById('titlebar-title')||{}).textContent||''};})()`);
    check('janela frameless: sem menu nativo, barra arrastável, controles e menus custom', noMenu && !!bar && bar.drag && bar.controles && bar.menus === 2 && bar.titulo.includes('demo.md'), JSON.stringify(bar));

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

    // 11. menu Arquivo abre por clique e fecha no Escape
    await js(`document.querySelector('#menu-arquivo > button').click()`);
    await sleep(200);
    const menuAberto = await js(`!document.querySelector('#menu-arquivo .menu-drop').classList.contains('hidden')`);
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await sleep(200);
    const menuFechado = await js(`document.querySelector('#menu-arquivo .menu-drop').classList.contains('hidden')`);
    check('menu Arquivo abre e fecha', menuAberto && menuFechado, 'aberto=' + menuAberto + ' fechado=' + menuFechado);

    // 12. screenshot final
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
