// Tabs and editor groups.
//
// A PANE is one open file: its own Vditor instance, path and dirty flag. Panes
// live in GROUPS: a column with a tab bar on top, showing one pane at a time.
// Groups sit side by side (up to three, no grid), separated by a resizer the
// user drags, and a tab dragged onto the left or right half of the editor area
// splits the view. Emptying a group collapses it and hands its width to the
// neighbour.
//
// This replaced the sliding panes, which died on first real contact: opening
// every file in a folder turned most of them into unreadable 40px spines.

import {
  config, registerConfigDefaults, saveConfig,
  panes, groups, MAX_GROUPS, nextPaneId, nextGroupId, groupById, activeGroup,
  activePane, getActivePaneId, setActivePaneId, touchMru, dropFromMru, mruOrder,
  baseName, dirName
} from './state.js';
import { svgIcon, ICON_X, ICON_SPARKLES, ICON_FOLDER_OPEN, ICON_FILE, ICON_CHEVRON, ICON_PLUS } from './icons.js';
import { updateChrome } from './titlebar.js';
import { refreshSidebar, pushRecent, revealDirInTree, getTreeRoot, setSidebarVisible, isSidebarHidden } from './tree.js';
import { refreshFmPanel, scheduleFmRefresh } from './frontmatter.js';
import { applyFocusMode, applyTypewriterMode, caretMoved } from './focus-typewriter.js';
import { sendPaneToClaude } from './ai-bridge.js';
import { gitBadge, gitStateFor, openDiff, scheduleGitRefresh } from './git.js';

// lucide git-compare, for the "view file diff" button in the pane header.
const ICON_DIFF = ['M16 3h5v5', 'M8 3H3v5', 'M12 22v-8', 'M3 8a9 9 0 0 0 9 6', 'M21 8a9 9 0 0 1-9 6'];

const panesEl = document.getElementById('panes');
const emptyStateEl = document.getElementById('editor-empty');

// The layout the app reopens with. `session` is the list of groups, the files
// in each and which one was active: enough that a restart is not jarring, and
// deliberately not a workspace system (nothing about scroll, selection or
// window is stored here).
registerConfigDefaults({
  session: null // { groups: [{ size, files: [...] }], active: <path> }
});

const MIN_GROUP = 260; // a group narrower than this is not a place to read text

// Inline math ($...$) is pure noise in a markdown editor for AI: "R$ 300" and
// "from R$ 297 to R$ 397" turn into a formula and swallow the sentence. Lute
// (the Vditor parser) can be told to stop at runtime, and there is no equivalent
// option on the Vditor options object, hence this direct touch on the instance
// as soon as it exists. Block math ($$...$$) keeps working.
function disableInlineMath(vd) {
  const lute = vd && vd.vditor && vd.vditor.lute;
  if (lute && typeof lute.SetInlineMath === 'function') lute.SetInlineMath(false);
}

// Vditor lazy loads its own assets relative to `cdn`, which points at the
// vendored copy in src/renderer/vendor (synced from node_modules by
// scripts/sync-vendor.mjs), never at node_modules directly.
const VDITOR_CDN = 'vendor/vditor';

function vditorOptions(pane) {
  return {
    mode: 'ir',
    cdn: VDITOR_CDN,
    height: '100%',
    theme: 'dark',
    lang: 'en_US',
    toolbar: [],
    toolbarConfig: { hide: true },
    cache: { enable: false },
    preview: {
      theme: { current: 'dark', path: VDITOR_CDN + '/dist/css/content-theme' },
      hljs: { style: 'native', lineNumber: false },
      markdown: { toc: true, mark: true },
      // A digit right after the opening marker would be math ("$300$"). Here it
      // is a price, so it stays off (the real switch is the SetInlineMath call
      // above; this is the seat belt).
      math: { inlineDigit: false }
    },
    placeholder: '',
    input: () => {
      setPaneDirty(pane, true);
      // The first character typed into an untitled tab retires the empty state.
      if (!emptyStateEl.classList.contains('hidden')) updateEmptyState();
      // Editing the document rebuilds the properties panel (debounced), because
      // the frontmatter may have been edited by hand inside the editor.
      scheduleFmRefresh(pane);
      // Typing moves the caret: focus mode re-marks the block, typewriter recenters.
      caretMoved();
    },
    after: () => {
      pane.ready = true;
      disableInlineMath(pane.vditor);
    }
  };
}

// --- the empty state (no file in the active editor) ---
// A layer over the editor void, not a pane: it never intercepts the pointer, so
// an untitled tab underneath still takes the first keystroke.

export function updateEmptyState() {
  const p = activePane();
  let empty = panes.length === 0;
  if (!empty && p && !p.path) {
    let text = '';
    try {
      text = p.ready && p.vditor ? p.vditor.getValue() : '';
    } catch {
      text = '';
    }
    empty = text.trim() === '';
  }
  emptyStateEl.classList.toggle('hidden', !empty);
}

// --- groups ---

function applyGroupSizes() {
  for (const g of groups) g.el.style.flexGrow = String(g.size);
}

// Sizes are relative, so they drift: a collapsed group hands its width to the
// neighbour, and the next split would then open at 3 to 1 instead of half and
// half. Rescaling to a mean of 1 after every structural change keeps the
// proportions the user dragged while making a brand new group an equal peer.
function normalizeGroupSizes() {
  const sum = groups.reduce((acc, g) => acc + (g.size > 0 ? g.size : 1), 0);
  if (!sum || !groups.length) return;
  const k = groups.length / sum;
  for (const g of groups) g.size = (g.size > 0 ? g.size : 1) * k;
}

// Rebuilds the row of groups with a resizer between each pair. Re-appending an
// element only moves it, so the Vditor instances inside survive untouched.
function mountGroups() {
  panesEl.innerHTML = '';
  groups.forEach((g, i) => {
    if (i > 0) panesEl.appendChild(makeResizer(i - 1));
    panesEl.appendChild(g.el);
  });
  normalizeGroupSizes();
  applyGroupSizes();
}

function makeResizer(i) {
  const r = document.createElement('div');
  r.className = 'group-resizer';
  r.title = 'Drag to resize the editor groups';
  r.setAttribute('role', 'separator');
  r.setAttribute('aria-orientation', 'vertical');
  r.setAttribute('aria-label', 'Resize the editor groups');
  r.addEventListener('mousedown', (e) => startGroupResize(e, i));
  return r;
}

function startGroupResize(e, i) {
  const a = groups[i];
  const b = groups[i + 1];
  if (!a || !b) return;
  e.preventDefault();
  const aw = a.el.getBoundingClientRect().width;
  const bw = b.el.getBoundingClientRect().width;
  const total = aw + bw;
  const sum = a.size + b.size;
  const x0 = e.clientX;
  document.body.classList.add('resizing-groups');
  const move = (ev) => {
    let na = aw + (ev.clientX - x0);
    na = Math.max(MIN_GROUP, Math.min(total - MIN_GROUP, na));
    a.size = (sum * na) / total;
    b.size = sum - a.size;
    applyGroupSizes();
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.classList.remove('resizing-groups');
    persistLayout();
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

export function createGroup(atIndex) {
  if (groups.length >= MAX_GROUPS) return null;
  const id = nextGroupId();
  const el = document.createElement('div');
  el.className = 'group';
  el.dataset.groupId = String(id);

  const tabsEl = document.createElement('div');
  tabsEl.className = 'tab-bar';
  tabsEl.setAttribute('role', 'tablist');
  tabsEl.setAttribute('aria-label', 'Open files');

  const newBtn = document.createElement('button');
  newBtn.className = 'tab-new';
  newBtn.title = 'New file (Ctrl+N)';
  newBtn.setAttribute('aria-label', 'New file');
  newBtn.appendChild(svgIcon(13, ICON_PLUS));

  const bodyEl = document.createElement('div');
  bodyEl.className = 'group-body';

  tabsEl.appendChild(newBtn);
  el.appendChild(tabsEl);
  el.appendChild(bodyEl);

  const group = { id, el, tabsEl, bodyEl, newBtn, tabs: [], currentId: null, size: 1 };
  const at = typeof atIndex === 'number' ? Math.max(0, Math.min(groups.length, atIndex)) : groups.length;
  groups.splice(at, 0, group);

  newBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    newFileInGroup(group);
  });
  el.addEventListener('mousedown', () => {
    // Clicking anywhere in a group makes its current tab the active one.
    const cur = group.tabs.find((p) => p.id === group.currentId);
    if (cur && cur.id !== getActivePaneId()) setActivePane(cur);
  });
  wireGroupDrop(group);
  mountGroups();
  return group;
}

function removeGroup(group) {
  const i = groups.indexOf(group);
  if (i === -1 || groups.length <= 1) return;
  groups.splice(i, 1);
  // The space goes to the neighbour rather than being spread thin over all of
  // them: the eye expects the gap to close where it opened.
  const neighbour = groups[i] || groups[i - 1];
  if (neighbour) neighbour.size += group.size;
  group.el.remove();
  mountGroups();
}

function syncPanesArray() {
  panes.length = 0;
  for (const g of groups) for (const p of g.tabs) panes.push(p);
}

function groupOf(pane) {
  return groupById(pane.groupId);
}

// --- tabs ---

function tabTitle(pane) {
  return pane.path ? baseName(pane.path) : 'untitled';
}

function renderTabs(group) {
  for (const p of group.tabs) group.tabsEl.insertBefore(p.tabEl, group.newBtn);
  for (const p of group.tabs) {
    const current = p.id === group.currentId;
    p.tabEl.classList.toggle('active', current);
    p.tabEl.setAttribute('aria-selected', current ? 'true' : 'false');
    p.tabEl.tabIndex = current ? 0 : -1;
    p.el.classList.toggle('current', current);
  }
}

function createTab(pane) {
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.setAttribute('role', 'tab');
  tab.draggable = true;
  tab.dataset.paneId = String(pane.id);

  const dot = document.createElement('span');
  dot.className = 'tab-dot';
  dot.setAttribute('role', 'status');

  const label = document.createElement('span');
  label.className = 'tab-label';

  const close = document.createElement('button');
  close.className = 'tab-close';
  close.title = 'Close (Ctrl+W)';
  close.setAttribute('aria-label', 'Close this tab');
  close.appendChild(svgIcon(11, ICON_X));

  tab.appendChild(dot);
  tab.appendChild(label);
  tab.appendChild(close);

  tab.addEventListener('click', () => {
    setActivePane(pane);
    if (pane.vditor && pane.ready) pane.vditor.focus();
  });
  // Middle click closes, the way every tab bar has worked for twenty years.
  tab.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    closePane(pane);
  });
  tab.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll cursor
  });
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    closePane(pane);
  });
  wireTabDrag(tab, pane);

  pane.tabEl = tab;
  pane.titleEl = label;
  pane.tabDotEl = dot;
  return tab;
}

function updateTab(pane) {
  const name = tabTitle(pane);
  pane.titleEl.textContent = name;
  pane.tabEl.title = pane.path || name;
  pane.tabEl.classList.toggle('dirty', pane.dirty);
  pane.tabDotEl.setAttribute('aria-label', pane.dirty ? 'Unsaved changes' : 'Saved');
  pane.tabDotEl.title = pane.dirty ? 'Unsaved changes' : '';
  const closeBtn = pane.tabEl.querySelector('.tab-close');
  if (closeBtn) closeBtn.setAttribute('aria-label', 'Close ' + name);
}

// --- drag and drop ---
//
// The dragged pane id travels in the dataTransfer AND in a module variable: the
// payload is what a real drag carries, the variable is what survives a drop
// handler that gets an empty dataTransfer (which is also what lets the E2E
// drive this without faking the whole clipboard).

const DND_TYPE = 'application/x-wired-tab';
let draggingPaneId = null;

function draggedPane(e) {
  let id = draggingPaneId;
  try {
    const raw = e.dataTransfer ? e.dataTransfer.getData(DND_TYPE) : '';
    if (raw) id = Number(raw);
  } catch {}
  return panes.find((p) => p.id === id) || null;
}

function wireTabDrag(tab, pane) {
  tab.addEventListener('dragstart', (e) => {
    draggingPaneId = pane.id;
    tab.classList.add('dragging');
    panesEl.classList.add('dragging-tab');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData(DND_TYPE, String(pane.id));
        e.dataTransfer.setData('text/plain', pane.path || tabTitle(pane));
      } catch {}
    }
  });
  tab.addEventListener('dragend', () => {
    draggingPaneId = null;
    tab.classList.remove('dragging');
    panesEl.classList.remove('dragging-tab');
    clearDropHints();
  });
}

function clearDropHints() {
  for (const g of groups) {
    g.el.classList.remove('drop-left', 'drop-right');
    for (const p of g.tabs) p.tabEl.classList.remove('drop-before', 'drop-after');
  }
}

// Where a drop on this tab bar would land, in tab index terms.
function insertIndexAt(group, clientX) {
  const tabs = group.tabs;
  for (let i = 0; i < tabs.length; i++) {
    const r = tabs[i].tabEl.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return i;
  }
  return tabs.length;
}

function wireGroupDrop(group) {
  group.tabsEl.addEventListener('dragover', (e) => {
    if (!draggedPane(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearDropHints();
    const idx = insertIndexAt(group, e.clientX);
    const marker = group.tabs[idx];
    if (marker) marker.tabEl.classList.add('drop-before');
    else if (group.tabs.length) group.tabs[group.tabs.length - 1].tabEl.classList.add('drop-after');
  });
  group.tabsEl.addEventListener('drop', (e) => {
    const pane = draggedPane(e);
    if (!pane) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = insertIndexAt(group, e.clientX);
    clearDropHints();
    moveTabToGroup(pane.id, group.id, idx);
  });

  group.bodyEl.addEventListener('dragover', (e) => {
    if (!draggedPane(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    clearDropHints();
    group.el.classList.add(halfAt(group, e.clientX) === 'left' ? 'drop-left' : 'drop-right');
  });
  group.bodyEl.addEventListener('drop', (e) => {
    const pane = draggedPane(e);
    if (!pane) return;
    e.preventDefault();
    const half = halfAt(group, e.clientX);
    clearDropHints();
    dropTabOnGroupHalf(pane.id, group.id, half);
  });
  group.bodyEl.addEventListener('dragleave', (e) => {
    if (e.target === group.bodyEl) group.el.classList.remove('drop-left', 'drop-right');
  });
}

function halfAt(group, clientX) {
  const r = group.bodyEl.getBoundingClientRect();
  return clientX < r.left + r.width / 2 ? 'left' : 'right';
}

// Moves a tab into a group at an index (the same group means a reorder).
export function moveTabToGroup(paneId, groupId, index) {
  const pane = panes.find((p) => p.id === paneId);
  const target = groupById(groupId);
  if (!pane || !target) return false;
  const from = groupOf(pane);
  const fromIdx = from ? from.tabs.indexOf(pane) : -1;
  let at = typeof index === 'number' ? index : target.tabs.length;
  if (from === target) {
    if (at > fromIdx) at -= 1; // the tab leaving its own slot shifts the target
    if (at === fromIdx) return false;
  }
  if (from) {
    from.tabs.splice(fromIdx, 1);
    if (from.currentId === pane.id) from.currentId = from.tabs.length ? from.tabs[Math.min(fromIdx, from.tabs.length - 1)].id : null;
  }
  target.tabs.splice(Math.max(0, Math.min(at, target.tabs.length)), 0, pane);
  pane.groupId = target.id;
  target.bodyEl.appendChild(pane.el);
  target.currentId = pane.id;
  syncPanesArray();
  if (from && from !== target) {
    if (from.tabs.length === 0) removeGroup(from);
    else renderTabs(from);
  }
  renderTabs(target);
  setActivePaneId(null);
  setActivePane(pane);
  persistLayout();
  return true;
}

// A tab dropped on the left or right half of a group's editor area: a new group
// opens on that side. At the group ceiling the tab moves into the group that is
// already there instead, which is the only honest thing left to do.
export function dropTabOnGroupHalf(paneId, groupId, half) {
  const pane = panes.find((p) => p.id === paneId);
  const target = groupById(groupId);
  if (!pane || !target) return false;
  const gi = groups.indexOf(target);
  const at = half === 'left' ? gi : gi + 1;
  const from = groupOf(pane);
  // Dropping the only tab of a group back onto its own half changes nothing.
  if (from === target && target.tabs.length === 1) return false;
  if (groups.length >= MAX_GROUPS) {
    const neighbour = groups[half === 'left' ? gi - 1 : gi + 1] || target;
    return moveTabToGroup(paneId, neighbour.id, neighbour.tabs.length);
  }
  const fresh = createGroup(at);
  if (!fresh) return false;
  // The new group is born with the width of a comfortable half of the one it
  // split off from.
  target.size = target.size / 2;
  fresh.size = target.size;
  applyGroupSizes();
  return moveTabToGroup(paneId, fresh.id, 0);
}

// --- panes ---

export function updatePaneHeader(pane) {
  updateTab(pane);
  pane.el.classList.toggle('dirty-file', pane.dirty);
  // git state of THIS file, beside the breadcrumb; the diff button only shows up
  // when there is something to diff.
  if (pane.gitSlotEl) {
    pane.gitSlotEl.dataset.path = pane.path || '';
    pane.gitSlotEl.innerHTML = '';
    const badge = gitBadge(pane.path);
    if (badge) pane.gitSlotEl.appendChild(badge);
  }
  if (pane.diffBtn) {
    pane.diffBtn.dataset.path = pane.path || '';
    const st = gitStateFor(pane.path);
    pane.diffBtn.style.display = st && st !== '!' ? '' : 'none';
  }
  updatePaneBreadcrumb(pane);
}

// --- breadcrumb in the pane header ---
// Left to right: the button that opens the folder in Explorer, then the folder
// path, then the file. The folder segments are dim and separated by a chevron
// (a slash reads as text); the file name closes the trail in full ink with a
// file icon, so folder and file are never the same thing at a glance. The path
// shown is relative to the root of the open tree, not absolute (noise, and it
// leaks the machine's structure); every segment carries its full path in the
// tooltip, and a deep path collapses in the middle.

function sepOf(p) {
  return p.indexOf('\\') !== -1 ? '\\' : '/';
}

// Path prefix comparison, case tolerant (Windows does not care about case).
function isWithin(child, parent) {
  const c = child.toLowerCase();
  const p = parent.toLowerCase();
  return c === p || c.startsWith(p + sepOf(parent));
}

function paneCrumbSegments(notePath) {
  if (!notePath) return [];
  const folder = dirName(notePath);
  const root = getTreeRoot();
  if (!root || !isWithin(folder, root)) {
    // Outside the root (or no folder open): only the immediate parent, not clickable.
    return [{ name: baseName(folder), path: folder, clickable: false }];
  }
  const segs = [{ name: baseName(root), path: root, clickable: true }];
  const rest = folder.slice(root.length).replace(/^[\\/]+/, '');
  if (rest) {
    const sep = sepOf(root);
    let acc = root;
    for (const part of rest.split(/[\\/]+/)) {
      acc = acc + sep + part;
      segs.push({ name: part, path: acc, clickable: true });
    }
  }
  return segs;
}

function crumbChevron() {
  const sep = document.createElement('span');
  sep.className = 'crumb-sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.appendChild(svgIcon(11, ICON_CHEVRON));
  return sep;
}

function updatePaneBreadcrumb(pane) {
  const el = pane.crumbEl;
  if (!el) return;
  el.innerHTML = '';
  pane.folderBtn.style.display = pane.path ? '' : 'none';
  if (!pane.path) {
    el.title = '';
    return;
  }
  const segs = paneCrumbSegments(pane.path);
  el.title = pane.path; // tooltip carries the absolute path of the note
  // A very deep path collapses in the middle: root > ... > note folder.
  let display = segs;
  if (segs.length > 3) {
    const hidden = segs.slice(1, segs.length - 1).map((s) => s.name).join(' / ');
    display = [segs[0], { name: '…', clickable: false, title: hidden }, segs[segs.length - 1]];
  }
  display.forEach((s, i) => {
    if (i > 0) el.appendChild(crumbChevron());
    const seg = document.createElement('span');
    seg.className = 'crumb-seg' + (s.clickable ? ' clickable' : '');
    seg.textContent = s.name;
    seg.title = s.title || s.path || '';
    if (s.clickable) {
      seg.addEventListener('click', (e) => {
        e.stopPropagation();
        revealCrumb(s.path);
      });
    }
    el.appendChild(seg);
  });
  el.appendChild(crumbChevron());
  const file = document.createElement('span');
  file.className = 'crumb-file';
  const ico = svgIcon(12, ICON_FILE);
  ico.classList.add('crumb-file-ico');
  file.appendChild(ico);
  const name = document.createElement('span');
  name.className = 'crumb-file-name';
  name.textContent = baseName(pane.path);
  file.appendChild(name);
  file.title = pane.path;
  el.appendChild(file);
}

export function updateAllBreadcrumbs() {
  for (const p of panes) updatePaneBreadcrumb(p);
}

// Opens the note's folder in Explorer (reuses the fs:showInFolder IPC, which
// does shell.openPath when the target is a directory). lastNoteFolderReveal is
// left observable for the E2E, so the test never has to spy on the contextBridge
// object; suppressExplorer keeps a real Explorer window from covering the app
// during the test.
let lastNoteFolderReveal = null;
let suppressExplorer = false;

export function getLastNoteFolderReveal() {
  return lastNoteFolderReveal;
}

export function setLastNoteFolderReveal(v) {
  lastNoteFolderReveal = v;
}

export function getSuppressExplorer() {
  return suppressExplorer;
}

export function setSuppressExplorer(v) {
  suppressExplorer = !!v;
}

function openNoteFolder(pane) {
  if (!pane || !pane.path) return;
  lastNoteFolderReveal = dirName(pane.path);
  if (!suppressExplorer) window.wired.showInFolder(lastNoteFolderReveal);
}

// Clicking a segment reveals that folder in the sidebar tree WITHOUT changing
// the root (a clickable segment is always a descendant of the tree root, so it
// is already in the current tree).
function revealCrumb(dirPath) {
  if (isSidebarHidden()) setSidebarVisible(true);
  revealDirInTree(dirPath);
}

export function createPane(group, at) {
  const target = group || activeGroup() || createGroup();
  if (!target) return null;
  const id = nextPaneId();
  const el = document.createElement('div');
  el.className = 'pane';

  const header = document.createElement('div');
  header.className = 'pane-header';
  // The folder button comes FIRST, before the trail it belongs to; the sparkles
  // and the close button stay on the right edge.
  const folderBtn = document.createElement('button');
  folderBtn.className = 'pane-folder';
  folderBtn.title = 'Open the note folder in Explorer';
  folderBtn.setAttribute('aria-label', 'Open the note folder in Explorer');
  folderBtn.appendChild(svgIcon(13, ICON_FOLDER_OPEN));
  const crumbEl = document.createElement('span');
  crumbEl.className = 'pane-crumbs';
  // git badge for this file, right after the trail (empty when clean or when
  // there is no repository).
  const gitSlotEl = document.createElement('span');
  gitSlotEl.className = 'git-slot';
  // Read only diff of this file, hidden while there is nothing to show.
  const diffBtn = document.createElement('button');
  diffBtn.className = 'pane-diff';
  diffBtn.title = 'View file diff';
  diffBtn.setAttribute('aria-label', 'View file diff');
  diffBtn.style.display = 'none';
  diffBtn.appendChild(svgIcon(13, ICON_DIFF));
  const spacer = document.createElement('span');
  spacer.className = 'pane-header-spacer';
  // AI bridge per note: the sparkles in this header acts on this note.
  const claudeBtn = document.createElement('button');
  claudeBtn.className = 'pane-claude';
  claudeBtn.title = 'Send this note to claude';
  claudeBtn.setAttribute('aria-label', 'Send this note to claude');
  claudeBtn.appendChild(svgIcon(13, ICON_SPARKLES));
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-close';
  closeBtn.title = 'Close this tab (Ctrl+W)';
  closeBtn.setAttribute('aria-label', 'Close this tab');
  closeBtn.appendChild(svgIcon(12, ICON_X));
  header.appendChild(folderBtn);
  header.appendChild(crumbEl);
  header.appendChild(gitSlotEl);
  header.appendChild(diffBtn);
  header.appendChild(spacer);
  header.appendChild(claudeBtn);
  header.appendChild(closeBtn);

  // Properties panel (YAML frontmatter): between the header and the editor, one
  // per pane, because each pane is a different file.
  const fmEl = document.createElement('div');
  fmEl.className = 'fm-panel hidden';

  const edEl = document.createElement('div');
  edEl.className = 'pane-editor';
  edEl.id = 'pane-ed-' + id;

  el.appendChild(header);
  el.appendChild(fmEl);
  el.appendChild(edEl);
  target.bodyEl.appendChild(el);

  const pane = {
    id, groupId: target.id, el, crumbEl, folderBtn, gitSlotEl, diffBtn, fmEl,
    fmTimer: null, path: null, dirty: false, vditor: null, ready: false
  };
  createTab(pane);
  pane.vditor = new Vditor(edEl.id, vditorOptions(pane));

  folderBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openNoteFolder(pane);
  });
  claudeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sendPaneToClaude(pane);
  });
  diffBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDiff(pane.path);
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePane(pane);
  });

  const idx = typeof at === 'number' ? Math.max(0, Math.min(at, target.tabs.length)) : target.tabs.length;
  target.tabs.splice(idx, 0, pane);
  target.currentId = pane.id;
  syncPanesArray();
  renderTabs(target);
  touchMru(id);
  updatePaneHeader(pane);
  updateEmptyState();
  return pane;
}

export function setActivePane(pane) {
  if (!pane) return;
  touchMru(pane.id);
  const group = groupOf(pane);
  if (group) {
    group.currentId = pane.id;
    renderTabs(group);
    if (pane.tabEl) pane.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (getActivePaneId() === pane.id) {
    updateEmptyState();
    return;
  }
  setActivePaneId(pane.id);
  for (const p of panes) p.el.classList.toggle('active', p.id === pane.id);
  for (const g of groups) g.el.classList.toggle('active', !!group && g.id === group.id);
  // Focus and typewriter only apply to the active pane: switching moves both.
  applyFocusMode();
  applyTypewriterMode();
  updateChrome();
  updateEmptyState();
  refreshSidebar();
  persistLayout();
}

export function closePane(pane) {
  if (!pane) return;
  if (pane.dirty && !confirm('This tab has unsaved changes. Close it anyway?')) return;
  const group = groupOf(pane);
  const idx = group ? group.tabs.indexOf(pane) : -1;
  if (!group || idx === -1) return;
  try {
    pane.vditor.destroy();
  } catch {}
  pane.el.remove();
  pane.tabEl.remove();
  group.tabs.splice(idx, 1);
  dropFromMru(pane.id);
  syncPanesArray();

  const wasActive = getActivePaneId() === pane.id;
  const wasCurrent = group.currentId === pane.id;
  if (group.tabs.length) {
    // Closing a tab in the background never moves the tab you are looking at.
    if (wasCurrent) group.currentId = group.tabs[Math.min(idx, group.tabs.length - 1)].id;
    renderTabs(group);
  } else {
    group.currentId = null;
    if (groups.length > 1) removeGroup(group);
  }
  if (wasActive) {
    setActivePaneId(null);
    const next = nextAfterClose(group);
    if (next) setActivePane(next);
    else {
      updateChrome();
      updateEmptyState();
      refreshSidebar();
    }
  } else {
    updateEmptyState();
  }
  persistLayout();
}

// After closing the active tab: the most recently used tab still open, which is
// the group's own next tab in the common case.
function nextAfterClose(group) {
  if (group && group.tabs.length) {
    const cur = group.tabs.find((p) => p.id === group.currentId);
    if (cur) return cur;
  }
  for (const id of mruOrder()) {
    const p = panes.find((x) => x.id === id);
    if (p) return p;
  }
  return panes[0] || null;
}

export function closeActivePane() {
  const p = activePane();
  if (p) closePane(p);
}

export function setPaneDirty(pane, v) {
  if (pane.dirty === v) return;
  pane.dirty = v;
  updatePaneHeader(pane);
  if (pane.id === getActivePaneId()) updateChrome();
}

// Compat: setDirty applies to the active pane.
export function setDirty(v) {
  const p = activePane();
  if (p) setPaneDirty(p, v);
}

export function paneWithPath(p) {
  return panes.find((x) => x.path === p) || null;
}

// --- session layout, persisted in config ---

let persistTimer = null;

export function sessionSnapshot() {
  return {
    groups: groups.map((g) => ({
      size: Number(g.size.toFixed(4)),
      files: g.tabs.map((p) => p.path).filter(Boolean)
    })),
    active: activePane() ? activePane().path : null
  };
}

export function persistLayout() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    config.session = sessionSnapshot();
    saveConfig();
  }, 250);
}

// Reopens the layout of the last session. It only ever runs when the app booted
// with nothing open (a file on the command line wins over the session), and a
// file that has since been deleted or renamed is skipped in silence.
export async function restoreSession() {
  const snap = config.session;
  if (!snap || !Array.isArray(snap.groups) || panes.length > 0) return false;
  let opened = 0;
  for (let i = 0; i < snap.groups.length && i < MAX_GROUPS; i++) {
    const spec = snap.groups[i] || {};
    const group = groups[i] || createGroup();
    if (!group) break;
    if (spec.size > 0) group.size = spec.size;
    for (const file of spec.files || []) {
      const res = await window.wired.readFile(file);
      if (!res || !res.ok) continue;
      const pane = createPane(group);
      if (!pane) continue;
      await openInPane(pane, file, res.content);
      opened += 1;
    }
  }
  applyGroupSizes();
  const wanted = panes.find((p) => p.path === snap.active) || panes[0];
  if (wanted) {
    setActivePaneId(null);
    setActivePane(wanted);
  }
  updateEmptyState();
  return opened > 0;
}

// --- opening ---

// The group beside the active one: the second group, created on demand.
function besideGroup() {
  const cur = activeGroup();
  const i = groups.indexOf(cur);
  if (i !== -1 && groups[i + 1]) return groups[i + 1];
  // No group on the right yet: open one while there is room, and only fall back
  // to the group on the left once the ceiling is reached.
  return createGroup(i + 1) || groups[i - 1] || cur;
}

// Opens the file in a tab. With side=true the tab lands in the group beside the
// active one (creating it when there is room); a file already open anywhere
// simply gets its tab focused.
export async function openPath(p, side) {
  const existing = panes.find((x) => x.path === p);
  if (existing) {
    setActivePane(existing);
    pushRecent(p); // back to the top of Recents even without reopening
    return;
  }
  const group = side ? besideGroup() : activeGroup() || createGroup();
  if (!group) return;
  const pane = createPane(group);
  if (!pane) return;
  setActivePane(pane);
  await openInPane(pane, p);
}

// A brand new pane answers `ready` from the Vditor `after` hook, a few frames
// later. Opening WAITS for it instead of leaving a note for the hook to pick up:
// whoever awaits openPath (the template flow places a caret right after) has to
// find the document already in the editor.
function whenReady(pane) {
  if (pane.ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (pane.ready || Date.now() - started > 8000) {
        clearInterval(tick);
        resolve(!!pane.ready);
      }
    }, 25);
  });
}

export async function openInPane(pane, p, preloaded) {
  if (!pane.ready && !(await whenReady(pane))) return;
  if (pane.path === p) return;
  let content = preloaded;
  if (content === undefined) {
    const res = await window.wired.readFile(p);
    if (!res.ok) {
      alert('Could not open the file: ' + res.error);
      // An empty tab that failed to open is litter, not a state.
      if (!pane.path) closePane(pane);
      return;
    }
    content = res.content;
  }
  pane.path = p;
  pane.vditor.setValue(content);
  setPaneDirty(pane, false);
  refreshFmPanel(pane);
  // setValue swaps the DOM blocks: the focus marker has to be redone.
  applyFocusMode();
  updatePaneHeader(pane);
  if (pane.id === getActivePaneId()) updateChrome();
  updateEmptyState();
  pushRecent(p);
  refreshSidebar();
  persistLayout();
}

export async function save() {
  const pane = activePane();
  if (!pane || !pane.vditor) return;
  if (!pane.path) {
    saveAs();
    return;
  }
  const res = await window.wired.writeFile(pane.path, pane.vditor.getValue());
  if (!res.ok) {
    alert('Save failed: ' + res.error);
    return;
  }
  setPaneDirty(pane, false);
  scheduleGitRefresh(); // a save is exactly what turns a clean file into M
}

export async function saveAs() {
  const pane = activePane();
  if (!pane || !pane.vditor) return;
  const p = await window.wired.saveAsDialog(pane.path);
  if (!p) return;
  const res = await window.wired.writeFile(p, pane.vditor.getValue());
  if (!res.ok) {
    alert('Save failed: ' + res.error);
    return;
  }
  pane.path = p;
  setPaneDirty(pane, false);
  refreshFmPanel(pane); // the file name decides the schema (SKILL.md, agents/)
  updatePaneHeader(pane);
  updateChrome();
  updateEmptyState();
  pushRecent(p);
  refreshSidebar();
  persistLayout();
}

function newFileInGroup(group) {
  const pane = createPane(group);
  if (!pane) return null;
  setActivePane(pane);
  updateEmptyState();
  persistLayout();
  return pane;
}

// A new file is a NEW TAB, never the erasure of the one in front of you.
export function newFile() {
  return newFileInGroup(activeGroup() || createGroup());
}

export async function openViaDialog(side) {
  const p = await window.wired.openDialog();
  if (p) openPath(p, !!side);
}

// Boot: one group with no tab in it, which is the Lain empty state.
export function initPanes() {
  createGroup();
  updateEmptyState();
}
