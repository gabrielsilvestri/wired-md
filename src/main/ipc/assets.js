// Links and assets: the window never navigates away from index.html, external
// links go to the default browser through one validated door, relative links
// resolve against the note that holds them, and pasted images land next to the
// note under assets/.

const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const MD_EXT = /\.(md|markdown)$/i;
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };

// Every URL handed to the browser in a test run is recorded here instead of
// really opening one (the suite must never launch a browser).
const externalLog = [];

// The only door to shell.openExternal: http, https and mailto, nothing else (no
// file:, no javascript:). Both the renderer's link click and window.open land here.
function openExternal(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  if (!EXTERNAL_SCHEMES.has(parsed.protocol)) return false;
  if (process.env.WIRED_E2E === '1') {
    externalLog.push(parsed.href);
    return true;
  }
  shell.openExternal(parsed.href).catch(() => {});
  return true;
}

function stripHash(u) {
  const i = u.indexOf('#');
  return i === -1 ? u : u.slice(0, i);
}

// Pins a window to its own page: a link, a dropped file or a script that tries
// to navigate it is stopped, and a new window request is denied (the three safe
// schemes go to the browser instead).
function guardWindow(win) {
  const wc = win.webContents;
  const block = (ev, url) => {
    if (stripHash(url) === stripHash(wc.getURL())) return;
    ev.preventDefault();
  };
  wc.on('will-navigate', block);
  wc.on('will-redirect', block);
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
}

// "<note-name>-<yyyymmdd-hhmmss>.<ext>"; a name that is taken gets -2, -3 ...
// in savePasted, so nothing is ever overwritten.
function pastedName(notePath, ext, now) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' +
    pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const stem = path.basename(notePath).replace(/\.(md|markdown)$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '-') || 'note';
  return stem + '-' + stamp + '.' + ext;
}

function savePasted(notePath, mime, bytes) {
  if (typeof notePath !== 'string' || !path.isAbsolute(notePath) || !MD_EXT.test(notePath)) {
    return { ok: false, error: 'save the note first' };
  }
  const ext = IMAGE_EXT[String(mime).toLowerCase()];
  if (!ext) return { ok: false, error: 'not a supported image type' };
  const dir = path.join(path.dirname(notePath), 'assets');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const base = pastedName(notePath, ext, new Date());
    const stem = base.slice(0, -(ext.length + 1));
    let name = base;
    for (let n = 2; n < 1000; n++) {
      try {
        // 'wx' fails when the file exists, so an existing image is never touched.
        fs.writeFileSync(path.join(dir, name), Buffer.from(bytes), { flag: 'wx' });
        return { ok: true, rel: 'assets/' + name, path: path.join(dir, name) };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        name = stem + '-' + n + '.' + ext;
      }
    }
    return { ok: false, error: 'could not pick a free file name' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// A link target that is a path: resolved against the folder of the note that
// holds it. Only Markdown notes are ever handed back to the app.
function resolveLink(notePath, target) {
  let raw = String(target || '');
  const h = raw.indexOf('#');
  const hash = h === -1 ? '' : raw.slice(h + 1);
  raw = h === -1 ? raw : raw.slice(0, h);
  const q = raw.indexOf('?');
  if (q !== -1) raw = raw.slice(0, q);
  try {
    raw = decodeURIComponent(raw);
  } catch {}
  if (/^file:\/\//i.test(raw)) {
    try {
      raw = fileURLToPath(raw);
    } catch {
      return { ok: false, error: 'bad file link' };
    }
  }
  if (raw === '') return { ok: false, error: 'empty link' };
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(notePath ? path.dirname(notePath) : process.cwd(), raw);
  if (!MD_EXT.test(abs)) return { ok: false, error: 'only Markdown notes open in the app', path: abs };
  let isFile = false;
  try {
    isFile = fs.statSync(abs).isFile();
  } catch {}
  if (!isFile) return { ok: false, error: 'file not found', path: abs };
  return { ok: true, path: abs, hash };
}

function register() {
  ipcMain.handle('link:openExternal', (_ev, url) => ({ ok: openExternal(url) }));
  ipcMain.handle('link:resolve', (_ev, notePath, target) => resolveLink(notePath, target));
  ipcMain.handle('assets:savePasted', (_ev, notePath, mime, bytes) => savePasted(notePath, mime, bytes));
}

module.exports = { register, guardWindow, openExternal, externalLog, resolveLink, savePasted };
