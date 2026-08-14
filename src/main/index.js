// Main process of wired-md.
//
// Creates the frameless window, resolves a file passed on the command line and
// wires the IPC modules. Every handler lives in its own file under ipc/ and
// registers itself; this file only owns the window and the app lifecycle.

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Redirect the whole user data folder (config, themes, snippets, templates).
// Lets test runs live in an isolated profile instead of the owner's real
// %APPDATA%\wired-md, so parallel suites never trample each other.
if (process.env.WIRED_USERDATA) {
  app.setPath('userData', path.resolve(process.env.WIRED_USERDATA));
}

const { ensureUserDirs } = require('./config');
const { readWindowState, saveWindowState } = require('./window-state');
const fsIpc = require('./ipc/fs');
const treeIpc = require('./ipc/tree');
const searchIpc = require('./ipc/search');
const customizationIpc = require('./ipc/customization');
const terminalIpc = require('./ipc/terminal');
const gitIpc = require('./ipc/git');
const cli = require('./cli');

let mainWindow = null;

// Single instance: a second `wired` invocation is not a second editor, it is a
// command for the one already open (see src/main/cli.js). Losing the lock means
// this process exists only to hand its argv over, so it quits at once.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const E2E = process.env.WIRED_E2E === '1';
const SMOKE = process.env.WIRED_SMOKE === '1';

// In the test modes the window is usually COVERED by another one (the terminal
// that launched the test), and then Chromium marks it as occluded on Windows and
// stops rendering: the viewport freezes at its last width, CSS transitions never
// advance and every layout measurement lies. Turning occlusion detection off in
// the test modes keeps the app really running behind another window. In normal
// use detection stays on (it saves battery).
if (E2E || SMOKE) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// The .md file passed as a command line argument, if there is one.
function fileFromArgv(argv) {
  const candidates = argv.slice(1).filter((a) => /\.(md|markdown)$/i.test(a));
  for (const c of candidates.reverse()) {
    const abs = path.resolve(c);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function getWindow() {
  return mainWindow;
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
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
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Persists size and position (debounced on the continuous events).
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState(mainWindow);
  });

  // The maximized state goes to the renderer so it can swap the maximize icon.
  mainWindow.on('maximize', () => send('window:maximized', true));
  mainWindow.on('unmaximize', () => send('window:maximized', false));

  mainWindow.webContents.on('did-finish-load', () => {
    const initial = fileFromArgv(process.argv);
    if (initial) mainWindow.webContents.send('open-file-path', initial);
    // The automated suites live in tests/ and are only loaded behind their env
    // var: the app itself never carries them.
    if (SMOKE) require('../../tests/smoke').run({ window: mainWindow, app });
    if (E2E) require('../../tests/e2e/driver').run({ window: mainWindow, app, filePath: initial });
    // A cold start through the CLI (`wired open x.md` with no app running).
    const cold = cli.parseArgv(process.argv);
    if (cold) cli.execute(cold, { getWindow, templatesDir: path.join(app.getPath('userData'), 'templates') });
  });

  mainWindow.on('closed', () => {
    terminalIpc.killTerminal();
    treeIpc.closeDirWatcher();
    mainWindow = null;
  });
}

// --- window IPC (the custom title bar) ---

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

// Title of the OS window (file name plus the modified marker).
ipcMain.on('window:setTitle', (_ev, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});

fsIpc.register({ getWindow });
treeIpc.register({ send });
searchIpc.register();
customizationIpc.register();
terminalIpc.register({ send });
gitIpc.register();

// A later `wired ...` hands its argv here instead of opening a second window.
app.on('second-instance', (_ev, argv, workingDirectory) => {
  const cmd = cli.parseArgv(argv);
  if (!cmd) {
    if (mainWindow) mainWindow.focus();
    return;
  }
  cmd.cwd = cmd.cwd || workingDirectory;
  cli.execute(cmd, { getWindow, templatesDir: path.join(app.getPath('userData'), 'templates') });
});

// Everything below only belongs to the instance that HOLDS the lock. The one
// that lost it exists for a fraction of a second to deliver its argv, and it
// must not touch the user data folder of the live one.
if (gotLock) {
  app.whenReady().then(() => {
    // Fully custom window: no leftover native menu.
    Menu.setApplicationMenu(null);
    ensureUserDirs();
    cli.writeInstanceFile(app.getPath('userData'), path.join(__dirname, '..', '..'));
    createWindow();
  });

  app.on('will-quit', () => cli.clearInstanceFile(app.getPath('userData')));
}

app.on('window-all-closed', () => {
  terminalIpc.killTerminal();
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { fileFromArgv, getWindow };
