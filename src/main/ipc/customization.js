// Customization IPC: config.json, themes, CSS snippets and templates.
//
// Themes and snippets are .css files in %APPDATA%\wired-md; templates are .md
// in the same place. All three folders are read on demand, so a file dropped in
// there with the app running shows up without a restart and without a watcher.

const { ipcMain, shell } = require('electron');
const fs = require('fs');
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
}

module.exports = { register };
