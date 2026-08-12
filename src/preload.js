// Ponte segura entre renderer e main. Só expõe o que o editor precisa.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wired', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveAsDialog: (suggested) => ipcRenderer.invoke('dialog:saveAs', suggested),

  // janela (barra de título custom)
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
  setTitle: (t) => ipcRenderer.send('window:setTitle', t),
  onOpenFilePath: (cb) => ipcRenderer.on('open-file-path', (_ev, p) => cb(p)),

  // configuração, temas e snippets
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  listThemes: () => ipcRenderer.invoke('themes:list'),
  readTheme: (name) => ipcRenderer.invoke('themes:read', name),
  listSnippets: () => ipcRenderer.invoke('snippets:list'),
  readSnippet: (file) => ipcRenderer.invoke('snippets:read', file),
  openSnippetsFolder: () => ipcRenderer.invoke('snippets:openFolder'),
  openThemesFolder: () => ipcRenderer.invoke('themes:openFolder'),

  // terminal
  termStart: (cwd, cols, rows) => ipcRenderer.invoke('term:start', cwd, cols, rows),
  termInput: (data) => ipcRenderer.send('term:input', data),
  termInterrupt: () => ipcRenderer.invoke('term:interrupt'),
  termResize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),
  termKill: () => ipcRenderer.invoke('term:kill'),
  onTermData: (cb) => ipcRenderer.on('term:data', (_ev, d) => cb(d)),
  onTermExit: (cb) => ipcRenderer.on('term:exit', (_ev, c) => cb(c))
});
