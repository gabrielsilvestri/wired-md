// Custom context menu (HTML, in the app palette). Esc or a click outside closes
// it. The menus for a file, a folder and a Recents entry are built here.

import { config, saveConfig } from './state.js';
import { openPath } from './panes.js';
import { renameItem, trashItem, duplicateItem, exportItem, copyPathToClipboard, createNewMd, createNewFolder, renderRecents } from './tree.js';
import { newFromTemplate } from './templates.js';

const ctxMenuEl = document.getElementById('ctx-menu');

export function hideCtxMenu() {
  ctxMenuEl.classList.add('hidden');
}

export function showCtxMenu(x, y, items) {
  ctxMenuEl.innerHTML = '';
  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      ctxMenuEl.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '');
    row.textContent = it.label;
    // The menu never takes the focus: a paste from the editor menu has to land
    // in the editor that was focused, not on the menu row.
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', () => {
      hideCtxMenu();
      it.run();
    });
    ctxMenuEl.appendChild(row);
  }
  ctxMenuEl.classList.remove('hidden');
  // Restarts the entrance animation and positions the menu inside the window.
  ctxMenuEl.style.animation = 'none';
  void ctxMenuEl.offsetHeight;
  ctxMenuEl.style.animation = '';
  const r = ctxMenuEl.getBoundingClientRect();
  ctxMenuEl.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
  ctxMenuEl.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
}

export function isCtxMenuOpen() {
  return !ctxMenuEl.classList.contains('hidden');
}

window.addEventListener(
  'mousedown',
  (e) => {
    if (isCtxMenuOpen() && !ctxMenuEl.contains(e.target)) hideCtxMenu();
  },
  true
);

export function showFileContextMenu(e, p) {
  showCtxMenu(e.clientX, e.clientY, [
    { label: 'open', run: () => openPath(p, false) },
    { label: 'open beside', run: () => openPath(p, true) },
    { sep: true },
    { label: 'rename', run: () => renameItem(p) },
    { label: 'duplicate', run: () => duplicateItem(p) },
    { sep: true },
    { label: 'copy path', run: () => copyPathToClipboard(p) },
    { label: 'export...', run: () => exportItem(p) },
    { label: 'reveal in Explorer', run: () => window.wired.showInFolder(p) },
    { sep: true },
    { label: 'delete (recycle bin)', danger: true, run: () => trashItem(p) }
  ]);
}

export function showFolderContextMenu(e, p) {
  showCtxMenu(e.clientX, e.clientY, [
    { label: 'new .md file here', run: () => createNewMd(p) },
    { label: 'new from template here', run: () => newFromTemplate(p) },
    { label: 'new folder here', run: () => createNewFolder(p) },
    { sep: true },
    { label: 'rename', run: () => renameItem(p) },
    { label: 'reveal in Explorer', run: () => window.wired.showInFolder(p) },
    { sep: true },
    { label: 'delete (recycle bin)', danger: true, run: () => trashItem(p) }
  ]);
}

export function showRecentContextMenu(e, p) {
  showCtxMenu(e.clientX, e.clientY, [
    { label: 'open', run: () => openPath(p, false) },
    { label: 'open beside', run: () => openPath(p, true) },
    { sep: true },
    { label: 'copy path', run: () => copyPathToClipboard(p) },
    { label: 'reveal in Explorer', run: () => window.wired.showInFolder(p) },
    { sep: true },
    {
      label: 'remove from recents',
      run: () => {
        config.recentFiles = (config.recentFiles || []).filter((r) => r !== p);
        saveConfig();
        renderRecents();
      }
    }
  ]);
}
