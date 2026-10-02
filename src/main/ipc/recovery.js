// Unsaved edits that survive a crash. While a tab has unsaved changes the
// renderer keeps a snapshot of its text here (%APPDATA%\wired-md\recovery), and
// drops it once the tab is saved, closed clean or discarded on purpose. A
// snapshot still here at the next launch means the app went down with work in
// it, and the renderer offers it back. Plain JSON files, one per tab.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { userDir } = require('../config');

function dir() {
  return userDir('recovery');
}

function fileFor(key) {
  return path.join(dir(), crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 16) + '.json');
}

function save(key, entry) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    // Written to a temp name and renamed, so a crash mid write never leaves a
    // half snapshot that would hide the previous good one.
    const target = fileFor(key);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ key, path: entry.path || null, content: String(entry.content || ''), savedAt: Date.now() }), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

function drop(key) {
  try {
    fs.rmSync(fileFor(key), { force: true });
  } catch {}
  return true;
}

function list() {
  let names = [];
  try {
    names = fs.readdirSync(dir()).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8'));
      if (e && typeof e.content === 'string' && e.key) out.push(e);
    } catch {}
  }
  return out.sort((a, b) => a.savedAt - b.savedAt);
}

function register() {
  ipcMain.handle('recovery:save', (_ev, key, entry) => save(key, entry || {}));
  ipcMain.handle('recovery:drop', (_ev, key) => drop(key));
  ipcMain.handle('recovery:list', () => list());
}

module.exports = { register, save, drop, list };
