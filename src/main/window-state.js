// Window size, position and maximized state, persisted between sessions in
// %APPDATA%\wired-md\window-state.json.
//
// The default is a vertical text block, 700x840, like Notepad.

const fs = require('fs');
const { userDir } = require('./config');

const DEFAULT_WINDOW = { width: 700, height: 840 };

function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(userDir('window-state.json'), 'utf8'));
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch {}
  return Object.assign({}, DEFAULT_WINDOW);
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const maximized = win.isMaximized();
    // While maximized, store the normal (restore) bounds instead.
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(
      userDir('window-state.json'),
      JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }, null, 2),
      'utf8'
    );
  } catch {}
}

module.exports = { DEFAULT_WINDOW, readWindowState, saveWindowState };
