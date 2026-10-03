// Sidebar: the file tree of the folder of the open note, the Recents list, the
// tree toolbar (new file, new from template, new folder, sort, collapse, filter)
// and the file operations behind them.
//
// Only .md/.markdown files show up, and only folders that contain one at any
// depth. Deleting always goes through the Recycle Bin, never a hard unlink.

import { config, saveConfig, registerConfigDefaults, activePane, baseName, dirName } from './state.js';
import { svgIcon, ICON_CHEVRON, ICON_FOLDER, ICON_FILE } from './icons.js';
import { askInput } from './dialogs.js';
import { showCtxMenu, showFileContextMenu, showFolderContextMenu, showRecentContextMenu } from './context-menu.js';
import { openPath, newFile, setPaneDirty, closePane, paneWithPath, updatePaneHeader, updateAllBreadcrumbs } from './panes.js';
import { syncWatches } from './disk-sync.js';
import { updateChrome } from './titlebar.js';
import { newFromTemplate } from './templates.js';
import { gitSlot, scheduleGitRefresh } from './git.js';
import { notify } from './toast.js';

registerConfigDefaults({ sidebarWidth: 240, sidebarVisible: true, treeSort: 'az', recentFiles: [] });

const sidebar = document.getElementById('sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const fileTreeEl = document.getElementById('file-tree');
const recentListEl = document.getElementById('recent-list');
const recentSection = document.getElementById('recent-section');
const sidebarEmpty = document.getElementById('sidebar-empty');
const sidebarRootName = document.getElementById('sidebar-root-name');
const sidebarRootPath = document.getElementById('sidebar-root-path');
const treeSearchWrap = document.getElementById('tree-search-wrap');
const treeSearchInput = document.getElementById('tree-search');

let treeRoot = null; // root folder of the tree (the folder of the open note)
export const expandedDirs = new Set(); // open subfolders (closed by default, state kept across refreshes)
let treeFiles = []; // flat list of the files in the current tree (quick switcher)
let selectedDir = null; // last folder clicked in the tree (target of "new file" and "new folder")
let treeFilter = ''; // filter from the toolbar search (empty means no filter)
let lastTree = null; // last tree received from main (so a re-render costs no IPC)

export function getTreeRoot() {
  return treeRoot;
}

export function getTreeFiles() {
  return treeFiles;
}

export function getSelectedDir() {
  return selectedDir;
}

export function setSelectedDir(v) {
  selectedDir = v;
}

// Sorts the tree per config.treeSort: az, za or recent (modified first).
// Folders always sort by name (reversed on za).
function sortNode(node) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const mode = config.treeSort || 'az';
  node.dirs.sort(byName);
  if (mode === 'za') node.dirs.reverse();
  if (mode === 'recent') node.files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  else {
    node.files.sort(byName);
    if (mode === 'za') node.files.reverse();
  }
  for (const d of node.dirs) sortNode(d);
  return node;
}

// Prunes the tree by the filter: a file whose name contains the term stays, and
// so does any folder with a surviving descendant.
function filterNode(node, term) {
  const files = node.files.filter((f) => f.name.toLowerCase().includes(term));
  const dirs = [];
  for (const d of node.dirs) {
    const sub = filterNode(d, term);
    if (sub.files.length > 0 || sub.dirs.length > 0) dirs.push(Object.assign({}, d, { dirs: sub.dirs, files: sub.files }));
  }
  return { dirs, files };
}

function fileRow(f, depth) {
  const row = document.createElement('div');
  row.className = 'tree-row file';
  row.style.paddingLeft = 10 + depth * 14 + 'px';
  row.title = f.path;
  const ico = svgIcon(13, ICON_FILE);
  ico.classList.add('tree-ico');
  const name = document.createElement('span');
  name.className = 'tree-name';
  name.textContent = f.name;
  row.appendChild(ico);
  row.appendChild(name);
  row.appendChild(gitSlot(f.path)); // git badge, empty when the file is clean
  const p = activePane();
  if (p && f.path === p.path) row.classList.add('active');
  // Ctrl+click opens in a new pane beside; a plain click opens in the active one.
  row.addEventListener('click', (e) => {
    selectedDir = dirName(f.path);
    openPath(f.path, e.ctrlKey);
  });
  // Dragged into a note, the row becomes a relative link there (modules/links.js).
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-wired-path', f.path);
    e.dataTransfer.setData('text/plain', f.path);
    e.dataTransfer.effectAllowed = 'copyLink';
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showFileContextMenu(e, f.path);
  });
  return row;
}

function renderTreeLevel(container, node, depth) {
  for (const d of node.dirs) {
    const row = document.createElement('div');
    row.className = 'tree-row folder';
    row.style.paddingLeft = 10 + depth * 14 + 'px';
    row.title = d.path;
    const chev = svgIcon(11, ICON_CHEVRON);
    chev.classList.add('tree-chevron');
    const ico = svgIcon(13, ICON_FOLDER);
    ico.classList.add('tree-ico');
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = d.name;
    row.appendChild(chev);
    row.appendChild(ico);
    row.appendChild(name);
    const children = document.createElement('div');
    children.className = 'tree-children';
    // With a filter on, whatever survived stays open so the matches are visible.
    const open = treeFilter ? true : expandedDirs.has(d.path);
    row.classList.toggle('open', open);
    children.style.display = open ? '' : 'none';
    row.addEventListener('click', () => {
      selectedDir = d.path;
      if (treeFilter) return; // during a search the tree stays fully open
      if (expandedDirs.has(d.path)) expandedDirs.delete(d.path);
      else expandedDirs.add(d.path);
      const nowOpen = expandedDirs.has(d.path);
      row.classList.toggle('open', nowOpen);
      children.style.display = nowOpen ? '' : 'none';
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFolderContextMenu(e, d.path);
    });
    container.appendChild(row);
    renderTreeLevel(children, d, depth + 1);
    container.appendChild(children);
  }
  for (const f of node.files) container.appendChild(fileRow(f, depth + 0.35));
}

function flattenTree(node, out) {
  for (const f of node.files) out.push(f);
  for (const d of node.dirs) flattenTree(d, out);
  return out;
}

// Draws the tree already in memory (sorted and filtered), with no new IPC.
export function renderTree() {
  fileTreeEl.innerHTML = '';
  if (!lastTree) {
    // Two different states used to share one anonymous node, so CSS could not
    // give either its own hint. The class says which one this is.
    sidebarEmpty.className = 'sidebar-empty-noroot';
    sidebarEmpty.style.display = 'block';
    return;
  }
  const sorted = sortNode({ dirs: lastTree.dirs.slice(), files: lastTree.files.slice() });
  const term = treeFilter.trim().toLowerCase();
  const view = term ? filterNode(sorted, term) : sorted;
  if (view.dirs.length === 0 && view.files.length === 0) {
    sidebarEmpty.textContent = term ? 'nothing found' : 'no folder open';
    sidebarEmpty.className = term ? 'sidebar-empty-filter' : 'sidebar-empty-noroot';
    sidebarEmpty.style.display = 'block';
    return;
  }
  sidebarEmpty.style.display = 'none';
  renderTreeLevel(fileTreeEl, view, 0);
}

// A path is unreadable when the end is cut off, because the end is the part
// that identifies it. Cutting the MIDDLE keeps the drive and the last folders,
// which is what orients someone with several similar trees.
export function middleTruncate(text, max) {
  if (!text || text.length <= max) return text || '';
  const keepRight = Math.floor((max - 1) * 0.62);
  const keepLeft = max - 1 - keepRight;
  return text.slice(0, keepLeft) + '…' + text.slice(text.length - keepRight);
}

// The folder that CONTAINS the root of the tree. At a drive root there is no
// parent, and the row simply goes away instead of repeating the name.
function setRootPath(dir) {
  if (!sidebarRootPath) return;
  const parent = dir ? dirName(dir) : null;
  const show = !!parent && parent !== dir;
  sidebarRootPath.textContent = show ? middleTruncate(parent, 44) : '';
  sidebarRootPath.title = show ? dir : '';
  sidebarRootPath.style.display = show ? '' : 'none';
}

export async function refreshSidebar() {
  renderRecents();
  const p = activePane();
  const cur = p ? p.path : null;
  if (!cur) {
    lastTree = null;
    sidebarRootName.textContent = 'no folder';
    sidebarRootName.title = '';
    setRootPath(null);
    renderTree();
    updateAllBreadcrumbs();
    return;
  }
  const dir = dirName(cur);
  if (dir !== treeRoot) {
    treeRoot = dir;
    expandedDirs.clear();
    selectedDir = null;
    // Subfolders start closed when the root changes; opening one is a click.
    window.wired.watchDir(dir);
    scheduleGitRefresh(); // another folder can be another repository (or none)
  }
  // Header: the root folder name, with the full path in the tooltip, and the
  // parent path under it so "examples" is never just "examples" (with many
  // files open, WHERE the folder lives is half of the orientation).
  sidebarRootName.textContent = baseName(dir);
  sidebarRootName.title = dir;
  setRootPath(dir);
  const res = await window.wired.dirTree(dir);
  const tree = res.tree || { dirs: [], files: [] };
  treeFiles = flattenTree(tree, []);
  lastTree = res.ok ? tree : null;
  renderTree();
  // Every pane's relative path depends on treeRoot, which may have just changed.
  updateAllBreadcrumbs();
}

// Reveals a folder in the tree: expands every ancestor inside the root up to the
// target, scrolls to its row and flashes it.
export function revealDirInTree(dirPath) {
  if (!treeRoot) return;
  if (dirPath !== treeRoot && dirPath.toLowerCase().startsWith(treeRoot.toLowerCase())) {
    let cur = dirPath;
    while (cur && cur.length > treeRoot.length) {
      expandedDirs.add(cur);
      const parent = dirName(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  renderTree();
  let target = null;
  if (dirPath === treeRoot) {
    fileTreeEl.scrollTop = 0;
  } else {
    for (const r of fileTreeEl.querySelectorAll('.tree-row.folder')) {
      if (r.title === dirPath) {
        target = r;
        break;
      }
    }
    if (target) target.scrollIntoView({ block: 'nearest' });
  }
  const flashEl = target || fileTreeEl.querySelector('.tree-row');
  if (flashEl) {
    flashEl.classList.add('reveal-flash');
    setTimeout(() => flashEl.classList.remove('reveal-flash'), 1000);
  }
}

// --- recent files ---

const MAX_RECENT = 12;

export function pushRecent(p) {
  config.recentFiles = [p, ...(config.recentFiles || []).filter((r) => r !== p)].slice(0, MAX_RECENT);
  saveConfig();
  renderRecents();
}

export function renderRecents() {
  recentListEl.innerHTML = '';
  const list = config.recentFiles || [];
  recentSection.style.display = list.length > 0 ? '' : 'none';
  const ap = activePane();
  for (const p of list) {
    const li = document.createElement('li');
    li.textContent = baseName(p);
    li.title = p;
    if (ap && p === ap.path) li.classList.add('active');
    li.addEventListener('click', (e) => openPath(p, e.ctrlKey));
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showRecentContextMenu(e, p);
    });
    recentListEl.appendChild(li);
  }
}

// --- file operations ---

// After a rename (or a move), fixes panes and Recents that pointed at the old path.
export function pathRenamed(from, to) {
  const pane = paneWithPath(from);
  if (pane) {
    pane.path = to;
    updatePaneHeader(pane);
    updateChrome();
    syncWatches(); // the tab follows the file under its new name
  }
  const isDir = !/\.(md|markdown)$/i.test(from);
  // The map can produce a duplicate when the destination path was already in
  // Recents (from an older session), so dedupe while keeping the order.
  config.recentFiles = [...new Set((config.recentFiles || []).map((r) => {
    if (r === from) return to;
    if (isDir && r.startsWith(from + '\\')) return to + r.slice(from.length);
    return r;
  }))];
  saveConfig();
  refreshSidebar();
}

export function forgetPath(p) {
  const pane = paneWithPath(p);
  if (pane) {
    setPaneDirty(pane, false);
    closePane(pane);
  }
  config.recentFiles = (config.recentFiles || []).filter((r) => r !== p && !r.startsWith(p + '\\'));
  saveConfig();
  refreshSidebar();
}

export async function createNewMd(targetDir) {
  const dir = targetDir || selectedDir || treeRoot;
  if (!dir) {
    newFile();
    return;
  }
  let name = await askInput('new file in ' + baseName(dir), 'untitled.md', 'create');
  if (!name) return;
  if (!/\.(md|markdown)$/i.test(name)) name += '.md';
  const res = await window.wired.createFile(dir + '\\' + name);
  if (!res.ok) {
    notify('Could not create the file: ' + res.error);
    return;
  }
  await openPath(res.path, false);
}

export async function createNewFolder(targetDir) {
  const dir = targetDir || selectedDir || treeRoot;
  if (!dir) return;
  const name = await askInput('new folder in ' + baseName(dir), 'new folder', 'create');
  if (!name) return;
  const res = await window.wired.createDir(dir + '\\' + name);
  if (!res.ok) {
    notify('Could not create the folder: ' + res.error);
    return;
  }
  expandedDirs.add(res.path);
  refreshSidebar();
}

export async function renameItem(p) {
  const oldName = baseName(p);
  let name = await askInput('rename ' + oldName, oldName, 'rename');
  if (!name || name === oldName) return;
  if (/\.(md|markdown)$/i.test(oldName) && !/\.(md|markdown)$/i.test(name)) name += '.md';
  const to = dirName(p) + '\\' + name;
  const res = await window.wired.renamePath(p, to);
  if (!res.ok) {
    notify('Could not rename: ' + res.error);
    return;
  }
  if (expandedDirs.has(p)) {
    expandedDirs.delete(p);
    expandedDirs.add(to);
  }
  pathRenamed(p, to);
}

export async function trashItem(p) {
  const isDir = !/\.(md|markdown)$/i.test(p);
  if (!confirm('Send "' + baseName(p) + '" to the recycle bin' + (isDir ? ' (the whole folder)' : '') + '?')) return;
  const res = await window.wired.trashPath(p);
  if (!res.ok) {
    notify('Could not delete: ' + res.error);
    return;
  }
  forgetPath(p);
}

export async function duplicateItem(p) {
  const res = await window.wired.duplicateFile(p);
  if (!res.ok) {
    notify('Could not duplicate: ' + res.error);
    return;
  }
  refreshSidebar();
}

export function copyPathToClipboard(p) {
  navigator.clipboard.writeText(p).catch(() => {});
}

export async function exportItem(p) {
  const res = await window.wired.exportFile(p);
  if (!res.ok && !res.canceled) notify('Could not export: ' + res.error);
}

// --- tree toolbar ---

const SORT_LABELS = { az: 'name A to Z', za: 'name Z to A', recent: 'modified first' };

export function setTreeSort(mode) {
  config.treeSort = mode;
  saveConfig();
  renderTree();
  updateSortTooltip();
}

export function updateSortTooltip() {
  const btn = document.getElementById('btn-tree-sort');
  btn.title = 'Sort: ' + (SORT_LABELS[config.treeSort] || SORT_LABELS.az);
}

export function toggleTreeSearch(forceOpen) {
  const isHidden = treeSearchWrap.classList.contains('hidden');
  const open = forceOpen === undefined ? isHidden : forceOpen;
  treeSearchWrap.classList.toggle('hidden', !open);
  if (open) {
    treeSearchInput.focus();
  } else {
    treeSearchInput.value = '';
    treeFilter = '';
    renderTree();
  }
}

// --- sidebar: show, hide and resize (persisted in the config) ---

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;

export function applySidebarState() {
  const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(config.sidebarWidth) || 240));
  sidebar.style.width = w + 'px';
  const visible = config.sidebarVisible !== false;
  sidebar.classList.toggle('hidden', !visible);
  sidebarResizer.classList.toggle('hidden', !visible);
}

export function isSidebarHidden() {
  return sidebar.classList.contains('hidden');
}

export function setSidebarVisible(v) {
  config.sidebarVisible = !!v;
  applySidebarState();
  saveConfig();
}

export function toggleSidebar() {
  setSidebarVisible(isSidebarHidden());
}

export function setSidebarWidth(w) {
  config.sidebarWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w));
  applySidebarState();
}

export function initTree() {
  document.getElementById('btn-tree-new-file').addEventListener('click', () => createNewMd());
  document.getElementById('btn-tree-template').addEventListener('click', () => newFromTemplate());
  document.getElementById('btn-tree-new-folder').addEventListener('click', () => createNewFolder());
  document.getElementById('btn-tree-collapse').addEventListener('click', () => {
    expandedDirs.clear();
    renderTree();
  });
  document.getElementById('btn-tree-sort').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showCtxMenu(r.left, r.bottom + 4, ['az', 'za', 'recent'].map((m) => ({
      label: SORT_LABELS[m],
      checked: (config.treeSort || 'az') === m,
      run: () => setTreeSort(m)
    })));
  });
  document.getElementById('btn-tree-search').addEventListener('click', () => toggleTreeSearch());
  document.getElementById('btn-root-explorer').addEventListener('click', () => {
    if (treeRoot) window.wired.showInFolder(treeRoot);
  });

  treeSearchInput.addEventListener('input', () => {
    treeFilter = treeSearchInput.value;
    renderTree();
  });
  treeSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      toggleTreeSearch(false);
    }
    e.stopPropagation();
  });

  let resizing = false;
  sidebarResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizing = true;
    document.body.classList.add('resizing-sidebar');
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    setSidebarWidth(e.clientX);
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove('resizing-sidebar');
    saveConfig();
  });

  document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar);

  window.wired.onDirChanged(() => {
    refreshSidebar();
    scheduleGitRefresh();
  });
}
