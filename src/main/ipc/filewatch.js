// Watches every file that is open in a pane, so a note changed on disk by
// another tool (claude in the embedded terminal, the wired CLI, another editor)
// reaches its pane instead of being overwritten by the next save.
//
// One fs.watch per parent FOLDER, filtered by file name, never one per file:
// tools that save atomically (write a temp file, rename it over the note)
// replace the file node, and a watcher bound to the old node goes quiet. The
// folder sees the rename and the note is simply read again.
//
// The renderer decides what a change means (reload, conflict, gone). This file
// only reports what is on disk now.

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DEBOUNCE_MS = 120;
const READ_TRIES = 5;

// Windows paths compare case insensitively; elsewhere the case is the file.
function keyOf(p) {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

const files = new Map(); // key -> { path, dirKey, mtimeMs, size }
const dirs = new Map(); // dirKey -> { dir, watcher, keys: Set }
const timers = new Map(); // key -> debounce timer

let sendFn = () => {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function statOf(p) {
  try {
    const s = fs.statSync(p);
    return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null;
  } catch {
    return null;
  }
}

// A writer holding the file (an editor mid save, an antivirus scan) answers
// EBUSY or EPERM for a moment on Windows: wait a little and try again.
async function readWithRetry(p) {
  for (let i = 0; i < READ_TRIES; i++) {
    try {
      return { exists: true, content: fs.readFileSync(p, 'utf8') };
    } catch (err) {
      if (err.code === 'ENOENT') return { exists: false };
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) return { error: String(err.message || err) };
      await sleep(60 * (i + 1));
    }
  }
  return { error: 'the file stayed locked' };
}

// The gap of a delete then create save looks exactly like a deletion, so a
// missing file is checked once more before the pane is told it is gone.
async function settle(key) {
  const f = files.get(key);
  if (!f) return;
  let st = statOf(f.path);
  if (!st) {
    await sleep(150);
    if (!files.has(key)) return;
    st = statOf(f.path);
  }
  if (!st) {
    if (f.mtimeMs === -1) return; // already reported gone
    f.mtimeMs = -1;
    f.size = -1;
    sendFn('file:changed', { path: f.path, exists: false });
    return;
  }
  // Same mtime and size: nothing was written. This gate is what keeps a read
  // (which can bump the access time, and Windows reports that as a change)
  // from echoing back as another event forever.
  if (st.mtimeMs === f.mtimeMs && st.size === f.size) return;
  const res = await readWithRetry(f.path);
  if (!files.has(key) || res.error) return;
  f.mtimeMs = st.mtimeMs;
  f.size = st.size;
  if (!res.exists) {
    f.mtimeMs = -1;
    f.size = -1;
    sendFn('file:changed', { path: f.path, exists: false });
    return;
  }
  sendFn('file:changed', { path: f.path, exists: true, content: res.content });
}

function schedule(key) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    settle(key);
  }, DEBOUNCE_MS));
}

function closeDir(dirKey) {
  const d = dirs.get(dirKey);
  if (!d) return;
  try {
    if (d.watcher) d.watcher.close();
  } catch {}
  dirs.delete(dirKey);
}

// A folder watcher that cannot be created now (the folder is gone) is retried
// on the next set call, which the renderer sends after every open and save.
function armDir(dirKey, dir) {
  let d = dirs.get(dirKey);
  if (!d) {
    d = { dir, watcher: null, keys: new Set() };
    dirs.set(dirKey, d);
  }
  if (d.watcher) return d;
  try {
    d.watcher = fs.watch(dir, (_type, name) => {
      if (!name) {
        for (const k of d.keys) schedule(k);
        return;
      }
      const k = keyOf(path.join(dir, String(name)));
      if (d.keys.has(k)) schedule(k);
    });
    d.watcher.on('error', () => {
      // The folder itself went away: every file in it is gone too.
      try {
        d.watcher.close();
      } catch {}
      d.watcher = null;
      for (const k of d.keys) schedule(k);
    });
  } catch {
    d.watcher = null;
  }
  return d;
}

function setWatched(list) {
  const wanted = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    if (typeof p === 'string' && p) wanted.set(keyOf(p), path.resolve(p));
  }
  for (const [key, f] of files) {
    if (wanted.has(key)) continue;
    files.delete(key);
    clearTimeout(timers.get(key));
    timers.delete(key);
    const d = dirs.get(f.dirKey);
    if (d) {
      d.keys.delete(key);
      // No handle left on a folder nobody watches: on Windows a watched folder
      // can refuse to be deleted.
      if (d.keys.size === 0) closeDir(f.dirKey);
    }
  }
  for (const [key, p] of wanted) {
    const dir = path.dirname(p);
    const dirKey = keyOf(dir);
    if (!files.has(key)) {
      const st = statOf(p);
      files.set(key, { path: p, dirKey, mtimeMs: st ? st.mtimeMs : -1, size: st ? st.size : -1 });
    }
    armDir(dirKey, dir).keys.add(key);
  }
  return { ok: true, count: files.size };
}

function closeAllFileWatchers() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  for (const k of [...dirs.keys()]) closeDir(k);
  files.clear();
}

function register({ send }) {
  sendFn = send;
  ipcMain.handle('filewatch:set', (_ev, list) => setWatched(list));
  // The pre save check: what is on disk right now, and whether it exists at all
  // (a missing file is a save that recreates it, not an error).
  ipcMain.handle('filewatch:read', async (_ev, p) => {
    const res = await readWithRetry(p);
    if (res.error) return { ok: false, error: res.error };
    return { ok: true, exists: res.exists, content: res.exists ? res.content : null };
  });
}

module.exports = { register, closeAllFileWatchers };
