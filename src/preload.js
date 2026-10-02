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

// The map of the block, or null when the frontmatter is not a map of keys.
// Every editing function below works on the Document, never on the plain object,
// so what was not touched comes back byte for byte.
function fmMap(doc) {
  const map = doc.contents;
  if (!map || !Array.isArray(map.items)) return null;
  return map;
}

function fmHasKey(map, key) {
  return map.items.some((p) => p.key && String(p.key.value) === String(key));
}

// Renames a key IN PLACE: the Pair keeps its position in the list, its value
// node and the comments attached to it, so order, comments and unknown keys
// survive. Only the key text changes.
function fmRename(raw, oldKey, newKey) {
  try {
    const from = String(oldKey == null ? '' : oldKey);
    const to = String(newKey == null ? '' : newKey).trim();
    if (to === '') return { ok: false, error: 'the key cannot be empty' };
    const doc = YAML.parseDocument(String(raw == null ? '' : raw));
    if (doc.errors && doc.errors.length > 0) return { ok: false, error: String(doc.errors[0].message) };
    const map = fmMap(doc);
    if (!map) return { ok: false, error: 'the frontmatter is not a map of keys' };
    if (to === from) return { ok: true, raw: doc.toString().replace(/\n+$/, '') };
    if (fmHasKey(map, to)) return { ok: false, error: 'the key "' + to + '" is already there' };
    const pair = map.items.find((p) => p.key && String(p.key.value) === from);
    if (!pair) return { ok: false, error: 'the key "' + from + '" is not in the block' };
    pair.key.value = to;
    // The parsed Scalar carries the original text in `source`; leaving it there
    // would re-emit the OLD key and silently swallow the rename.
    delete pair.key.source;
    delete pair.key.type;
    return { ok: true, raw: doc.toString().replace(/\n+$/, '') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// Appends a key with the empty value of its kind. Appending never reorders what
// is already there, so the existing keys, their comments and their formatting
// come back untouched.
const FM_EMPTY = { string: '', text: '', number: 0, list: [], bool: false, boolean: false };

function fmAdd(raw, key, kind) {
  try {
    const k = String(key == null ? '' : key).trim();
    if (k === '') return { ok: false, error: 'the key cannot be empty' };
    if (/[\r\n]/.test(k)) return { ok: false, error: 'the key cannot span lines' };
    const doc = YAML.parseDocument(String(raw == null ? '' : raw));
    if (doc.errors && doc.errors.length > 0) return { ok: false, error: String(doc.errors[0].message) };
    const map = fmMap(doc);
    if (map && fmHasKey(map, k)) return { ok: false, error: 'the key "' + k + '" is already there' };
    const empty = Object.prototype.hasOwnProperty.call(FM_EMPTY, String(kind)) ? FM_EMPTY[String(kind)] : '';
    doc.set(k, Array.isArray(empty) ? [] : empty);
    return { ok: true, raw: doc.toString().replace(/\n+$/, '') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// The product name, read once at preload time (sendSync, because the title bar
// paints before any promise could resolve). Single source: package.json.
const appName = ipcRenderer.sendSync('app:name');

contextBridge.exposeInMainWorld('wired', {
  appName,
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
  // open notes followed on disk (modules/disk-sync.js)
  watchFiles: (paths) => ipcRenderer.invoke('filewatch:set', paths),
  readForSync: (p) => ipcRenderer.invoke('filewatch:read', p),
  onFileChanged: (cb) => ipcRenderer.on('file:changed', (_ev, info) => cb(info)),
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

  // templates (new file from a template, and managing the template files)
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  readTemplate: (file) => ipcRenderer.invoke('templates:read', file),
  openTemplatesFolder: () => ipcRenderer.invoke('templates:openFolder'),
  templatePath: (file) => ipcRenderer.invoke('templates:path', file),
  createTemplate: (file, content) => ipcRenderer.invoke('templates:create', file, content),
  renameTemplate: (from, to) => ipcRenderer.invoke('templates:rename', from, to),
  trashTemplate: (file) => ipcRenderer.invoke('templates:trash', file),

  // terminal
  termStart: (cwd, cols, rows) => ipcRenderer.invoke('term:start', cwd, cols, rows),
  termInput: (data) => ipcRenderer.send('term:input', data),
  termInterrupt: () => ipcRenderer.invoke('term:interrupt'),
  termResize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),
  termKill: () => ipcRenderer.invoke('term:kill'),
  onTermData: (cb) => ipcRenderer.on('term:data', (_ev, d) => cb(d)),
  onTermExit: (cb) => ipcRenderer.on('term:exit', (_ev, c) => cb(c)),

  // git (status badges and the read only diff overlay)
  gitStatus: (dir) => ipcRenderer.invoke('git:status', dir),
  gitDiff: (file) => ipcRenderer.invoke('git:diff', file),

  // frontmatter (the properties panel)
  fmParse: (raw) => fmParse(raw),
  fmSet: (raw, key, kind, value) => fmSet(raw, key, kind, value),
  fmRename: (raw, oldKey, newKey) => fmRename(raw, oldKey, newKey),
  fmAdd: (raw, key, kind) => fmAdd(raw, key, kind)
});
