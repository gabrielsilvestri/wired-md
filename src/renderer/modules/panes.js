// Sliding panes: up to four files side by side, each pane owning its own Vditor
// instance, path and dirty flag.
//
// The active pane (and whatever else fits comfortably) keeps a flexible width;
// the ones that no longer fit collapse into a 40px spine with the title running
// vertically. Clicking a spine expands that pane.

import { panes, MAX_PANES, nextPaneId, activePane, getActivePaneId, setActivePaneId, touchMru, dropFromMru, mruOrder, baseName, dirName } from './state.js';
import { svgIcon, ICON_X, ICON_SPARKLES, ICON_FOLDER_OPEN } from './icons.js';
import { updateChrome } from './titlebar.js';
import { refreshSidebar, pushRecent, revealDirInTree, getTreeRoot, setSidebarVisible, isSidebarHidden } from './tree.js';
import { refreshFmPanel, scheduleFmRefresh } from './frontmatter.js';
import { applyFocusMode, applyTypewriterMode, caretMoved } from './focus-typewriter.js';
import { sendPaneToClaude } from './ai-bridge.js';
import { gitBadge, gitStateFor, openDiff, scheduleGitRefresh } from './git.js';

// lucide git-compare, for the "view file diff" button in the pane header.
const ICON_DIFF = ['M16 3h5v5', 'M8 3H3v5', 'M12 22v-8', 'M3 8a9 9 0 0 0 9 6', 'M21 8a9 9 0 0 1-9 6'];

const panesEl = document.getElementById('panes');

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

// The content theme Vditor injects at runtime lives with the app, not with the
// vendor copy: `path/current.css` is what Vditor loads.
const VDITOR_CONTENT_THEME_PATH = 'vditor-theme';
const VDITOR_CONTENT_THEME = 'wired';

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
      // Our own content theme (src/renderer/vditor-theme/wired.css), NOT the
      // vendored one: the vendored dark.css loads after styles.css and was
      // overruling this app's own colors, including the blue slab behind every
      // code block. The file itself carries the reasoning.
      theme: { current: VDITOR_CONTENT_THEME, path: VDITOR_CONTENT_THEME_PATH },
      // Vditor validates this name against its own list and silently falls back
      // to "github" (a LIGHT theme) when it does not match, which is what
      // "native" did here: light syntax colors over a dark surface, down to
      // #24292e body text at 1.1:1. The name is honest now, and it barely
      // matters, because styles.css paints every hljs token from theme
      // variables on top of whatever this stylesheet says.
      hljs: { style: 'github', lineNumber: false },
      markdown: { toc: true, mark: true },
      // A digit right after the opening marker would be math ("$300$"). Here it
      // is a price, so it stays off (the real switch is the SetInlineMath call
      // above; this is the seat belt).
      math: { inlineDigit: false }
    },
    placeholder: 'open a .md file or just start writing...',
    input: () => {
      setPaneDirty(pane, true);
      // Editing the document rebuilds the properties panel (debounced), because
      // the frontmatter may have been edited by hand inside the editor.
      scheduleFmRefresh(pane);
      // Typing moves the caret: focus mode re-marks the block, typewriter recenters.
      caretMoved();
    },
    after: () => {
      pane.ready = true;
      disableInlineMath(pane.vditor);
      if (pane.pendingPath) {
        const p = pane.pendingPath;
        pane.pendingPath = null;
        openInPane(pane, p);
      }
    }
  };
}

const SPINE_W = 40;
const PANE_COMFORT = 480; // comfortable minimum width of an open pane

export function relayoutPanes() {
  if (panes.length === 0) return;
  const total = panesEl.clientWidth || window.innerWidth || 800;
  // How many open panes fit: nOpen*COMFORT + (rest)*SPINE <= total.
  let nOpen = Math.floor((total - panes.length * SPINE_W) / (PANE_COMFORT - SPINE_W));
  nOpen = Math.max(1, Math.min(panes.length, nOpen));
  const openSet = new Set();
  for (const id of mruOrder()) {
    if (openSet.size >= nOpen) break;
    if (panes.some((p) => p.id === id)) openSet.add(id);
  }
  for (const p of panes) {
    if (openSet.size >= nOpen) break;
    openSet.add(p.id);
  }
  for (const p of panes) p.el.classList.toggle('collapsed', !openSet.has(p.id));
}

function updatePanesLayout() {
  panesEl.classList.toggle('single', panes.length === 1);
  relayoutPanes();
}

// A window resize (maximize, restore, dragging the edge) recomputes the layout
// right away; Vditor reflows on its own because the widths are flexible.
let panesResizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(panesResizeTimer);
  panesResizeTimer = setTimeout(relayoutPanes, 50);
}).observe(panesEl);

function paneTitleText(pane) {
  return pane.path ? baseName(pane.path) : 'untitled';
}

export function updatePaneHeader(pane) {
  pane.titleEl.textContent = (pane.dirty ? '● ' : '') + paneTitleText(pane);
  pane.titleEl.title = pane.path || '';
  pane.titleEl.classList.toggle('dirty', pane.dirty);
  // The spine shows the same title (vertically) and the amber dirty dot. A
  // collapsed pane is 40px of vertical text, so the file it holds has to be
  // readable from the tooltip and from a screen reader, not only from the glyphs.
  pane.spineTitleEl.textContent = paneTitleText(pane);
  pane.spineTitleEl.title = pane.path || '';
  if (pane.spineEl) {
    pane.spineEl.title = 'Expand ' + paneTitleText(pane);
    pane.spineEl.setAttribute('aria-label', 'Expand the pane holding ' + paneTitleText(pane));
  }
  pane.spineDotEl.classList.toggle('on', pane.dirty);
  // The dot is pure color, so the state it carries needs words of its own.
  pane.spineDotEl.setAttribute('aria-label', pane.dirty ? 'Unsaved changes' : 'Saved');
  pane.spineDotEl.title = pane.dirty ? 'Unsaved changes' : '';
  // git state of THIS file, beside the name; the diff button only shows up when
  // there is something to diff.
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
// Shows the FOLDER of the note relative to the root of the open tree, not the
// absolute path (noise, and it leaks the machine's structure). A note in the
// root shows only the root name. A note outside the root (or with no folder
// open) degrades to the immediate parent folder. The tooltip keeps the absolute
// path for whoever hovers.

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
  el.title = dirName(pane.path); // tooltip carries the full absolute path
  // A very deep path collapses in the middle: root / ... / note folder.
  let display = segs;
  if (segs.length > 3) {
    const hidden = segs.slice(1, segs.length - 1).map((s) => s.name).join(' / ');
    display = [segs[0], { name: '…', clickable: false, title: hidden }, segs[segs.length - 1]];
  }
  display.forEach((s, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      el.appendChild(sep);
    }
    const seg = document.createElement('span');
    seg.className = 'crumb-seg' + (s.clickable ? ' clickable' : '');
    seg.textContent = s.name;
    if (s.title) seg.title = s.title;
    if (s.clickable) {
      seg.addEventListener('click', (e) => {
        e.stopPropagation();
        revealCrumb(s.path);
      });
    }
    el.appendChild(seg);
  });
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

export function createPane() {
  if (panes.length >= MAX_PANES) return null;
  const id = nextPaneId();
  const el = document.createElement('div');
  el.className = 'pane';

  const header = document.createElement('div');
  header.className = 'pane-header';
  const titleEl = document.createElement('span');
  titleEl.className = 'pane-title';
  // Breadcrumb: the note folder relative to the open tree root, filling the gap
  // in the middle of the header. Each segment reveals the folder in the sidebar;
  // the button beside it opens the folder in Explorer.
  // git badge for this file, right after the name (empty when clean or when
  // there is no repository).
  const gitSlotEl = document.createElement('span');
  gitSlotEl.className = 'git-slot';
  const crumbEl = document.createElement('span');
  crumbEl.className = 'pane-crumbs';
  // Read only diff of this file, hidden while there is nothing to show.
  const diffBtn = document.createElement('button');
  diffBtn.className = 'pane-diff';
  diffBtn.title = 'View file diff';
  diffBtn.setAttribute('aria-label', 'View file diff');
  diffBtn.style.display = 'none';
  diffBtn.appendChild(svgIcon(13, ICON_DIFF));
  const folderBtn = document.createElement('button');
  folderBtn.className = 'pane-folder';
  folderBtn.title = 'Open the note folder in Explorer';
  folderBtn.setAttribute('aria-label', 'Open the note folder in Explorer');
  folderBtn.appendChild(svgIcon(13, ICON_FOLDER_OPEN));
  // AI bridge per note: the sparkles in this header acts on this note.
  const claudeBtn = document.createElement('button');
  claudeBtn.className = 'pane-claude';
  claudeBtn.title = 'Send this note to claude';
  claudeBtn.setAttribute('aria-label', 'Send this note to claude');
  claudeBtn.appendChild(svgIcon(13, ICON_SPARKLES));
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-close';
  closeBtn.title = 'Close pane';
  closeBtn.setAttribute('aria-label', 'Close pane');
  closeBtn.appendChild(svgIcon(12, ICON_X));
  header.appendChild(titleEl);
  header.appendChild(gitSlotEl);
  header.appendChild(crumbEl);
  header.appendChild(diffBtn);
  header.appendChild(folderBtn);
  header.appendChild(claudeBtn);
  header.appendChild(closeBtn);

  // Spine of a collapsed pane: X on top, dirty dot, vertical title.
  const spine = document.createElement('div');
  spine.className = 'pane-spine';
  spine.title = 'Expand this pane';
  spine.setAttribute('role', 'button');
  const spineClose = document.createElement('button');
  spineClose.className = 'pane-close spine-close';
  spineClose.title = 'Close pane';
  spineClose.setAttribute('aria-label', 'Close pane');
  spineClose.appendChild(svgIcon(12, ICON_X));
  const spineDotEl = document.createElement('span');
  spineDotEl.className = 'spine-dot';
  spineDotEl.setAttribute('role', 'status');
  const spineTitleEl = document.createElement('span');
  spineTitleEl.className = 'spine-title';
  spine.appendChild(spineClose);
  spine.appendChild(spineDotEl);
  spine.appendChild(spineTitleEl);

  // Properties panel (YAML frontmatter): between the header and the editor, one
  // per pane, because each pane is a different file.
  const fmEl = document.createElement('div');
  fmEl.className = 'fm-panel hidden';

  const edEl = document.createElement('div');
  edEl.className = 'pane-editor';
  edEl.id = 'pane-ed-' + id;

  el.appendChild(spine);
  el.appendChild(header);
  el.appendChild(fmEl);
  el.appendChild(edEl);
  panesEl.appendChild(el);

  const pane = {
    id, el, titleEl, crumbEl, folderBtn, gitSlotEl, diffBtn, spineEl: spine, spineTitleEl, spineDotEl, fmEl,
    fmTimer: null, path: null, dirty: false, vditor: null, ready: false, pendingPath: null
  };
  pane.vditor = new Vditor(edEl.id, vditorOptions(pane));

  el.addEventListener('mousedown', () => setActivePane(pane));
  spine.addEventListener('click', () => setActivePane(pane));
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
  spineClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closePane(pane);
  });

  panes.push(pane);
  touchMru(id);
  updatePanesLayout();
  updatePaneHeader(pane);
  return pane;
}

export function setActivePane(pane) {
  if (!pane) return;
  touchMru(pane.id);
  if (getActivePaneId() === pane.id) {
    relayoutPanes();
    return;
  }
  setActivePaneId(pane.id);
  for (const p of panes) p.el.classList.toggle('active', p.id === pane.id);
  relayoutPanes();
  // Focus and typewriter only apply to the active pane: switching moves both.
  applyFocusMode();
  applyTypewriterMode();
  updateChrome();
  refreshSidebar();
}

export function closePane(pane) {
  if (pane.dirty && !confirm('This pane has unsaved changes. Close it anyway?')) return;
  const idx = panes.indexOf(pane);
  if (idx === -1) return;
  try {
    pane.vditor.destroy();
  } catch {}
  pane.el.remove();
  panes.splice(idx, 1);
  dropFromMru(pane.id);
  if (panes.length === 0) {
    const fresh = createPane();
    setActivePaneId(fresh.id);
    fresh.el.classList.add('active');
  } else if (getActivePaneId() === pane.id) {
    const next = panes[Math.min(idx, panes.length - 1)];
    setActivePaneId(null);
    setActivePane(next);
  }
  updatePanesLayout();
  updateChrome();
  refreshSidebar();
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

// Opens the file in a pane. With side=true it opens a new pane to the right
// (respecting the ceiling of four); if the file is already open in some pane,
// that pane is simply activated.
export async function openPath(p, side) {
  const existing = panes.find((x) => x.path === p);
  if (existing) {
    setActivePane(existing);
    pushRecent(p); // back to the top of Recents even without reopening
    return;
  }
  let pane;
  if (side) {
    pane = createPane();
    if (pane) setActivePane(pane);
    else pane = activePane(); // pane ceiling: degrade to the active pane
  } else {
    pane = activePane();
  }
  if (!pane) return;
  await openInPane(pane, p);
}

export async function openInPane(pane, p) {
  if (!pane.ready) {
    pane.pendingPath = p;
    return;
  }
  if (pane.path === p) return;
  if (pane.dirty && !confirm('There are unsaved changes. Discard them and open another file?')) return;
  const res = await window.wired.readFile(p);
  if (!res.ok) {
    alert('Could not open the file: ' + res.error);
    return;
  }
  pane.path = p;
  pane.vditor.setValue(res.content);
  setPaneDirty(pane, false);
  refreshFmPanel(pane);
  // setValue swaps the DOM blocks: the focus marker has to be redone.
  applyFocusMode();
  updatePaneHeader(pane);
  if (pane.id === getActivePaneId()) updateChrome();
  pushRecent(p);
  refreshSidebar();
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
  pushRecent(p);
  refreshSidebar();
}

export function newFile() {
  const pane = activePane();
  if (!pane || !pane.vditor) return;
  if (pane.dirty && !confirm('There are unsaved changes. Discard them and start a new file?')) return;
  pane.path = null;
  pane.vditor.setValue('');
  setPaneDirty(pane, false);
  refreshFmPanel(pane);
  updatePaneHeader(pane);
  updateChrome();
  refreshSidebar();
}

export async function openViaDialog(side) {
  const p = await window.wired.openDialog();
  if (p) openPath(p, !!side);
}

// Boot: the first pane exists before anything else runs.
export function createFirstPane() {
  const first = createPane();
  setActivePaneId(first.id);
  first.el.classList.add('active');
  return first;
}
