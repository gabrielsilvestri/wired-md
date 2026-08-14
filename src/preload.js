// Safe bridge between the renderer and main. It exposes only what the editor
// needs, plus the frontmatter parser.

const { contextBridge, ipcRenderer } = require('electron');
const YAML = require('yaml');

// --- frontmatter: parsing and editing of the YAML block ---
// The parser runs here, in the preload, because the renderer is isolated (no
// require) and pushing this to main would be an IPC round trip on every
// keystroke. Only plain objects cross the bridge: the yaml Document never
// leaves this file.

// Classifies the value to decide which control the panel row gets.
function classify(v) {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'number';
  if (v === null || v === undefined) return 'string';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v) && v.every((x) => x === null || ['string', 'number', 'boolean'].includes(typeof x))) return 'list';
  return 'other';
}

function preview(v) {
  try {
    return YAML.stringify(v).trim().replace(/\s+/g, ' ').slice(0, 80);
  } catch {
    return '';
  }
}

function fmParse(raw) {
  let doc;
  try {
    doc = YAML.parseDocument(String(raw == null ? '' : raw));
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
  if (doc.errors && doc.errors.length > 0) {
    const e = doc.errors[0];
    return { ok: false, error: String(e.message || e) };
  }
  let js;
  try {
    js = doc.toJS();
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
  if (js === null || js === undefined) return { ok: true, isMap: true, entries: [] };
  if (typeof js !== 'object' || Array.isArray(js)) return { ok: true, isMap: false, entries: [] };
  const entries = [];
  for (const [key, value] of Object.entries(js)) {
    const kind = classify(value);
    entries.push({
      key,
      kind,
      value: kind === 'other' ? null : value === undefined ? null : value,
      preview: kind === 'other' ? preview(value) : ''
    });
  }
  return { ok: true, isMap: true, entries };
}

// Writes one key into the block and returns the re-emitted YAML. The yaml
// Document preserves order, comments, unknown keys and nested maps; only the
// value that was touched is rewritten.
function fmSet(raw, key, kind, value) {
  let doc;
  try {
    doc = YAML.parseDocument(String(raw == null ? '' : raw));
    if (doc.errors && doc.errors.length > 0) return { ok: false, error: String(doc.errors[0].message) };
    let v = value;
    if (kind === 'list') v = Array.isArray(value) ? value : [];
    if (kind === 'bool') v = !!value;
    if (kind === 'number') {
      const n = Number(value);
      v = Number.isFinite(n) ? n : String(value);
    }
    doc.set(key, v);
    return { ok: true, raw: doc.toString().replace(/\n+$/, '') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

contextBridge.exposeInMainWorld('wired', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveAsDialog: (suggested) => ipcRenderer.invoke('dialog:saveAs', suggested),

  // window (the custom title bar)
  winMinimize: () => ipcRenderer.send('window:minimize'),
  winMaximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
  winClose: () => ipcRenderer.send('window:close'),
  winIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximized: (cb) => ipcRenderer.on('window:maximized', (_ev, v) => cb(v)),

  readFile: (p) => ipcRenderer.invoke('file:read', p),
  writeFile: (p, content) => ipcRenderer.invoke('file:write', p, content),
  dirTree: (root) => ipcRenderer.invoke('dir:tree', root),
  watchDir: (root) => ipcRenderer.invoke('dir:watch', root),
  onDirChanged: (cb) => ipcRenderer.on('dir:changed', (_ev, root) => cb(root)),
  searchFolder: (root, query) => ipcRenderer.invoke('search:folder', root, query),
  setTitle: (t) => ipcRenderer.send('window:setTitle', t),

  // file operations behind the sidebar toolbar and context menu
  showInFolder: (p) => ipcRenderer.invoke('fs:showInFolder', p),
  createFile: (p) => ipcRenderer.invoke('fs:createFile', p),
  createDir: (p) => ipcRenderer.invoke('fs:createDir', p),
  renamePath: (from, to) => ipcRenderer.invoke('fs:rename', from, to),
  trashPath: (p) => ipcRenderer.invoke('fs:trash', p),
  duplicateFile: (p) => ipcRenderer.invoke('fs:duplicate', p),
  exportFile: (p) => ipcRenderer.invoke('fs:export', p),
  onOpenFilePath: (cb) => ipcRenderer.on('open-file-path', (_ev, p) => cb(p)),

  // config, themes and snippets
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  listThemes: () => ipcRenderer.invoke('themes:list'),
  readTheme: (name) => ipcRenderer.invoke('themes:read', name),
  listSnippets: () => ipcRenderer.invoke('snippets:list'),
  readSnippet: (file) => ipcRenderer.invoke('snippets:read', file),
  openSnippetsFolder: () => ipcRenderer.invoke('snippets:openFolder'),
  openThemesFolder: () => ipcRenderer.invoke('themes:openFolder'),
  importTheme: () => ipcRenderer.invoke('themes:import'),

  // templates (new file from a template)
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  readTemplate: (file) => ipcRenderer.invoke('templates:read', file),
  openTemplatesFolder: () => ipcRenderer.invoke('templates:openFolder'),

  // terminal
  termStart: (cwd, cols, rows) => ipcRenderer.invoke('term:start', cwd, cols, rows),
  termInput: (data) => ipcRenderer.send('term:input', data),
  termInterrupt: () => ipcRenderer.invoke('term:interrupt'),
  termResize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),
  termKill: () => ipcRenderer.invoke('term:kill'),
  onTermData: (cb) => ipcRenderer.on('term:data', (_ev, d) => cb(d)),
  onTermExit: (cb) => ipcRenderer.on('term:exit', (_ev, c) => cb(c)),

  // frontmatter (the properties panel)
  fmParse: (raw) => fmParse(raw),
  fmSet: (raw, key, kind, value) => fmSet(raw, key, kind, value)
});
