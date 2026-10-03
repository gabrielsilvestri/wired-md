// Main process of wired-md.
//
// Creates the frameless window, resolves a file passed on the command line and
// wires the IPC modules. Every handler lives in its own file under ipc/ and
// registers itself; this file only owns the window and the app lifecycle.

const { app, BrowserWindow, ipcMain, Menu, dialog, session } = require('electron');
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
const onboardingIpc = require('./ipc/onboarding');
const terminalIpc = require('./ipc/terminal');
const themeImportIpc = require('./ipc/theme-import');
const gitIpc = require('./ipc/git');
const fileWatchIpc = require('./ipc/filewatch');
const assetsIpc = require('./ipc/assets');
const importsIpc = require('./ipc/imports');
const editIpc = require('./ipc/edit');
const recoveryIpc = require('./ipc/recovery');
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
    // The taskbar icon of a dev run; the installed exe carries packaging/wired-md.ico.
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Vditor turns spellcheck off in the editor anyway, and with it on
      // Chromium downloads Hunspell dictionaries from Google on first launch:
      // a network call this offline editor has no use for.
      spellcheck: false
    }
  });

  if (state.maximized) mainWindow.maximize();

  // The window never leaves index.html; links go through assetsIpc.openExternal.
  assetsIpc.guardWindow(mainWindow);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Persists size and position (debounced on the continuous events).
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', (e) => {
    clearTimeout(saveTimer);
    saveWindowState(mainWindow);
    // Unsaved tabs are the renderer's to know about: the first close is held
    // and handed over as a request, and only its answer closes the window.
    // The test suites quit through app.exit, which never comes through here.
    if (closeConfirmed) return;
    e.preventDefault();
    send('window:close-request');
    // A renderer that never answers (crashed, hung) must not make the window
    // impossible to close: without an acknowledgement it closes anyway.
    clearTimeout(closeAckTimer);
    closeAckTimer = setTimeout(() => {
      closeConfirmed = true;
      if (mainWindow) mainWindow.close();
    }, 2500);
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
    fileWatchIpc.closeAllFileWatchers();
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

// Set once the renderer has dealt with every unsaved tab (or there were none).
let closeConfirmed = false;
let closeAckTimer = null;
ipcMain.on('window:close-ack', () => clearTimeout(closeAckTimer));
// Under WIRED_E2E the answer is recorded instead of closing the suite's window.
const closeLog = [];
ipcMain.on('window:close-confirmed', () => {
  if (E2E) {
    closeLog.push('closed');
    return;
  }
  closeConfirmed = true;
  if (mainWindow) mainWindow.close();
});
ipcMain.handle('window:close-log', () => closeLog.slice());

// The one native dialog on purpose: closing the window with unsaved work is the
// moment every editor asks, and the window is going away, so an inline row would
// not survive to be read. The buttons are the user's real choices.
ipcMain.handle('window:ask-unsaved', async (_ev, names) => {
  if (!mainWindow) return 'cancel';
  const list = (names || []).slice(0, 8).join('\n') + ((names || []).length > 8 ? '\n...' : '');
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Save all', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: app.getName(),
    message: (names || []).length === 1 ? 'Save the changes to this note before closing?' : 'Save the changes to these notes before closing?',
    detail: list
  });
  return ['save', 'discard', 'cancel'][response] || 'cancel';
});

ipcMain.handle('window:isMaximized', () => (mainWindow ? mainWindow.isMaximized() : false));

// The product name, straight out of package.json through Electron. It is
// answered SYNCHRONOUSLY because the preload hands it to the renderer as a
// plain string: the title bar needs it on its first paint, and a promise there
// would mean the window briefly showing a name that has to be corrected.
ipcMain.on('app:name', (ev) => {
  ev.returnValue = app.getName();
});

// Title of the OS window (file name plus the modified marker).
ipcMain.on('window:setTitle', (_ev, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});

fsIpc.register({ getWindow });
treeIpc.register({ send });
searchIpc.register();
customizationIpc.register();
onboardingIpc.register();
themeImportIpc.register({ getWindow });
terminalIpc.register({ send });
gitIpc.register();
fileWatchIpc.register({ send });
assetsIpc.register();
importsIpc.register();
editIpc.register();
recoveryIpc.register();

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
  app.whenReady()
    .then(() => {
      // Fully custom window: no leftover native menu.
      Menu.setApplicationMenu(null);
      // The spellchecker belongs to the session, not the window: without this
      // it still fetches a dictionary on first launch (see webPreferences).
      session.defaultSession.setSpellCheckerEnabled(false);
      session.defaultSession.setSpellCheckerLanguages([]);
      ensureUserDirs();
      // Retires the pre rename claro.css seed when it is untouched (Recycle Bin,
      // never unlink). Must run AFTER ensureUserDirs, which is what seeds it.
      themeImportIpc.sweepLegacySeeds();
      cli.writeInstanceFile(app.getPath('userData'), app.getAppPath());
      createWindow();
    })
    // A user data folder that cannot be created (an invalid WIRED_USERDATA, a
    // read only drive) used to surface as an unhandled rejection and a window
    // that half worked. Failing loudly and exiting is the honest answer.
    .catch((err) => {
      process.stderr.write('[wired-md] startup failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
      app.exit(1);
    });

  app.on('will-quit', () => cli.clearInstanceFile(app.getPath('userData')));
}

app.on('window-all-closed', () => {
  terminalIpc.killTerminal();
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { fileFromArgv, getWindow };
