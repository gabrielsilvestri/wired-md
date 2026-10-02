// Customization IPC: config.json, themes, CSS snippets and templates.
//
// Themes and snippets are .css files in %APPDATA%\wired-md; templates are .md
// in the same place. All three folders are read on demand, so a file dropped in
// there with the app running shows up without a restart and without a watcher.

const { app, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { userDir, DEFAULT_CONFIG, readConfig, writeConfig } = require('../config');

// Simple names only, no path traversal.
const SAFE_NAME = /^[\w\- .]+$/;
const SAFE_CSS_NAME = /^[\w\- .]+\.css$/i;
const TEMPLATE_NAME_RE = /^[^\\/:*?"<>|]+\.(md|markdown)$/i;

function listCss(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.css'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function register() {
  ipcMain.handle('config:get', () => readConfig());

  ipcMain.handle('config:set', (_ev, cfg) => {
    try {
      writeConfig(Object.assign({}, DEFAULT_CONFIG, cfg));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('themes:list', () => listCss(userDir('themes')).map((f) => f.replace(/\.css$/i, '')));

  ipcMain.handle('themes:read', (_ev, name) => {
    try {
      if (!SAFE_NAME.test(name)) return { ok: false, error: 'invalid name' };
      const css = fs.readFileSync(userDir('themes', name + '.css'), 'utf8');
      return { ok: true, css };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('snippets:list', () => listCss(userDir('snippets')));

  ipcMain.handle('snippets:read', (_ev, file) => {
    try {
      if (!SAFE_CSS_NAME.test(file)) return { ok: false, error: 'invalid name' };
      const css = fs.readFileSync(userDir('snippets', file), 'utf8');
      return { ok: true, css };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('snippets:openFolder', () => shell.openPath(userDir('snippets')));
  ipcMain.handle('themes:openFolder', () => shell.openPath(userDir('themes')));

  ipcMain.handle('templates:list', () => {
    try {
      return fs
        .readdirSync(userDir('templates'))
        .filter((f) => /\.(md|markdown)$/i.test(f))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => ({ file: f, name: f.replace(/\.(md|markdown)$/i, '') }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('templates:read', (_ev, file) => {
    try {
      if (!TEMPLATE_NAME_RE.test(String(file || ''))) return { ok: false, error: 'invalid name' };
      const content = fs.readFileSync(userDir('templates', file), 'utf8');
      return { ok: true, content };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('templates:openFolder', () => shell.openPath(userDir('templates')));

  // --- managing the template files from inside the app ---
  // Every path is rebuilt from userDir('templates') plus a name that passed
  // TEMPLATE_NAME_RE, so nothing here can point outside the folder. Deleting
  // goes through shell.trashItem (Recycle Bin), never unlink: a template the
  // user wrote is never destroyed by this app.

  const templateFile = (file) => {
    const name = String(file || '');
    if (!TEMPLATE_NAME_RE.test(name)) return null;
    return userDir('templates', name);
  };

  ipcMain.handle('templates:path', (_ev, file) => {
    const p = templateFile(file);
    if (!p) return { ok: false, error: 'invalid name' };
    return { ok: true, path: p };
  });

  ipcMain.handle('templates:create', (_ev, file, content) => {
    try {
      const p = templateFile(file);
      if (!p) return { ok: false, error: 'invalid name' };
      if (fs.existsSync(p)) return { ok: false, error: 'a template with that name already exists' };
      fs.writeFileSync(p, String(content == null ? '' : content), 'utf8');
      return { ok: true, path: p };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('templates:rename', (_ev, from, to) => {
    try {
      const src = templateFile(from);
      const dest = templateFile(to);
      if (!src || !dest) return { ok: false, error: 'invalid name' };
      if (src === dest) return { ok: true, path: dest };
      if (!fs.existsSync(src)) return { ok: false, error: 'the template is not there anymore' };
      if (fs.existsSync(dest)) return { ok: false, error: 'a template with that name already exists' };
      fs.renameSync(src, dest);
      return { ok: true, path: dest };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('templates:trash', async (_ev, file) => {
    try {
      const p = templateFile(file);
      if (!p) return { ok: false, error: 'invalid name' };
      if (!fs.existsSync(p)) return { ok: false, error: 'the template is not there anymore' };
      await shell.trashItem(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  registerCatalog();
}

// --- the theme gallery ---
// The catalog ships inside the app (themes/catalog) and is never seeded: a theme
// lands in the user's themes folder only when it is installed from the gallery.
// Packaged, the folder lives inside app.asar, so it is read the same way the
// seed reads (readFileSync plus writeFileSync, never copyFileSync).

function catalogDir() {
  return path.join(app.getAppPath(), 'themes', 'catalog');
}

// The :root declarations of a theme file, cut by counting braces (the same way
// theme.js and the contrast script do). Comments go first: they carry measured
// ratios and sample hex codes that would otherwise parse as variables.
function rootVars(css) {
  const out = {};
  const at = css.indexOf(':root');
  const open = at < 0 ? -1 : css.indexOf('{', at);
  let close = -1;
  for (let i = open, depth = 0; open >= 0 && i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) { close = i; break; }
  }
  if (close < 0) return out;
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

// The paragraph under the header line, used as the card tooltip. A theme
// without that comment simply has no description.
function aboutOf(css) {
  const m = /^\/\*[^\n]*\n\s*\n([\s\S]*?)(\n\s*\n|\*\/)/.exec(css);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function luminanceOf(hexValue) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hexValue || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function catalogNames() {
  return listCss(catalogDir()).map((f) => f.replace(/\.css$/i, ''));
}

function registerCatalog() {
  ipcMain.handle('themes:catalog', () => {
    const out = [];
    for (const name of catalogNames()) {
      try {
        const css = fs.readFileSync(path.join(catalogDir(), name + '.css'), 'utf8');
        const vars = rootVars(css);
        const lum = luminanceOf(vars['--bg']);
        out.push({
          name,
          dark: lum === null ? true : lum < 0.2,
          about: aboutOf(css),
          vars,
          installed: fs.existsSync(userDir('themes', name + '.css'))
        });
      } catch (err) {
        process.stderr.write('[wired-md] could not read catalog theme ' + name + ': ' + String(err.message || err) + '\n');
      }
    }
    return out;
  });

  // Never overwrites: a file with the same name in the themes folder may be
  // one the user edited, so it is reported as already installed and left alone.
  ipcMain.handle('themes:installCatalog', (_ev, name) => {
    try {
      const n = String(name || '');
      if (!SAFE_NAME.test(n) || !catalogNames().includes(n)) return { ok: false, error: 'not a catalog theme' };
      const target = userDir('themes', n + '.css');
      if (fs.existsSync(target)) return { ok: true, name: n, already: true };
      fs.mkdirSync(userDir('themes'), { recursive: true });
      fs.writeFileSync(target, fs.readFileSync(path.join(catalogDir(), n + '.css')));
      return { ok: true, name: n, already: false };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
}

module.exports = { register };
