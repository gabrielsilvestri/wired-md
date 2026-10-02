// Clipboard and selection commands for the editor's right click menu. They run
// on the webContents itself, the same path as the keyboard shortcuts, so a paste
// reaches Vditor (and the image paste handler) as a real paste event, which
// document.execCommand('paste') never does in a renderer.

const { ipcMain } = require('electron');

const COMMANDS = new Set(['cut', 'copy', 'paste', 'selectAll']);

function register() {
  ipcMain.handle('edit:command', (ev, cmd) => {
    if (!COMMANDS.has(cmd)) return false;
    ev.sender[cmd]();
    return true;
  });
}

module.exports = { register };
