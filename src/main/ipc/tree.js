// File tree of the folder of the open note, plus the recursive watcher that
// keeps the sidebar honest when files change on disk.
//
// The tree only carries .md/.markdown files and folders that contain one at any
// depth: this is a markdown editor, not a file manager.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const TREE_IGNORE = new Set(['node_modules', '.git', '.obsidian', '.trash']);
const MAX_DEPTH = 8;

function buildTree(dir, depth) {
  if (depth > MAX_DEPTH) return { dirs: [], files: [] };
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
  const cmp = (a, b) => a.name.localeCompare(b.name);
  dirs.sort(cmp);
  files.sort(cmp);
  return { dirs, files };
}

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

function register({ send }) {
  ipcMain.handle('dir:tree', async (_ev, root) => {
    try {
      if (!root || !fs.existsSync(root)) return { ok: false, error: 'folder does not exist', tree: { dirs: [], files: [] } };
      return { ok: true, tree: buildTree(root, 0) };
    } catch (err) {
      return { ok: false, error: String(err.message || err), tree: { dirs: [], files: [] } };
    }
  });

  // fs.watch on the note's folder: the sidebar refreshes itself when a new file
  // shows up (debounced here, the renderer only sees 'dir:changed').
  ipcMain.handle('dir:watch', (_ev, root) => {
    closeDirWatcher();
    if (!root || !fs.existsSync(root)) return { ok: false };
    try {
      dirWatcher = fs.watch(root, { recursive: true }, () => {
        clearTimeout(dirWatchTimer);
        dirWatchTimer = setTimeout(() => send('dir:changed', root), 350);
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
}

module.exports = { register, closeDirWatcher, TREE_IGNORE, MAX_DEPTH };
