// Git status where the writing happens: a letter badge on the tree row, the
// same badge in the pane header, and a read only diff overlay.
//
// Deliberately NOT a git client. There is no staging, no commit, no branch
// switching here: the embedded terminal already does all of that better than a
// button ever would. What the editor adds is the one thing the terminal cannot,
// which is showing the state of a file exactly where the file is being read.
//
// When git is missing, or the folder is not a repository, every call answers
// `ok: false` and this module draws nothing at all. No message, no empty state.

import { activePane, baseName } from './state.js';
import { getTreeRoot } from './tree.js';

// --- status ---

let statusMap = {}; // absolute path (lowercase) -> letter
let ignoredDirs = []; // lowercase absolute paths of folders git ignores wholesale
let repoRoot = null;
let refreshTimer = null;
let refreshSeq = 0;

const LABELS = { M: 'modified', A: 'added', '?': 'untracked', D: 'deleted', R: 'renamed', '!': 'ignored' };

export function getRepoRoot() {
  return repoRoot;
}

export function getGitStatusMap() {
  return statusMap;
}

// The letter for a path, or null when git has nothing to say about it (clean,
// or no repository at all).
export function gitStateFor(p) {
  if (!repoRoot || !p) return null;
  const key = p.toLowerCase();
  if (statusMap[key]) return statusMap[key];
  for (const dir of ignoredDirs) {
    if (key.startsWith(dir + '\\') || key.startsWith(dir + '/')) return '!';
  }
  return null;
}

// The badge element for a tree row or a pane header, or null when there is
// nothing to show. Callers append it and forget about it: the next refresh
// re-renders the row anyway.
export function gitBadge(p, extraClass) {
  const letter = gitStateFor(p);
  if (!letter) return null;
  const el = document.createElement('span');
  el.className = 'git-badge git-' + (letter === '?' ? 'untracked' : letter === '!' ? 'ignored' : letter.toLowerCase()) + (extraClass ? ' ' + extraClass : '');
  el.textContent = letter;
  el.title = 'git: ' + (LABELS[letter] || 'changed');
  return el;
}

// A single refresh. Everything that can change the answer (the watcher, a save,
// opening another folder) funnels through the debounced version below.
export async function refreshGitNow() {
  const root = getTreeRoot();
  const seq = ++refreshSeq;
  if (!root) {
    repoRoot = null;
    statusMap = {};
    ignoredDirs = [];
    paintBadges();
    return;
  }
  let res = null;
  try {
    res = await window.wired.gitStatus(root);
  } catch {
    res = null;
  }
  if (seq !== refreshSeq) return; // a newer refresh already answered
  if (!res || !res.ok) {
    repoRoot = null;
    statusMap = {};
    ignoredDirs = [];
    paintBadges();
    return;
  }
  repoRoot = res.root;
  statusMap = {};
  for (const [k, v] of Object.entries(res.files || {})) statusMap[k.toLowerCase()] = v;
  ignoredDirs = (res.ignoredDirs || []).map((d) => d.toLowerCase());
  paintBadges();
}

const REFRESH_DEBOUNCE = 300;

export function scheduleGitRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshGitNow, REFRESH_DEBOUNCE);
}

// Repaints the badges already on screen without asking the tree to re-render
// (the tree owns its own rows; this only swaps what is inside the badge slot).
function paintBadges() {
  for (const slot of document.querySelectorAll('.git-slot')) {
    const p = slot.dataset.path || '';
    slot.innerHTML = '';
    const badge = gitBadge(p);
    if (badge) slot.appendChild(badge);
  }
  for (const btn of document.querySelectorAll('.pane-diff')) {
    const p = btn.dataset.path || '';
    btn.style.display = p && gitStateFor(p) && gitStateFor(p) !== '!' ? '' : 'none';
  }
}

// The slot a row keeps for its badge, so a refresh never has to rebuild rows.
export function gitSlot(p) {
  const slot = document.createElement('span');
  slot.className = 'git-slot';
  slot.dataset.path = p || '';
  const badge = gitBadge(p);
  if (badge) slot.appendChild(badge);
  return slot;
}

// --- diff overlay (read only) ---
// Same visual family as the search and palette overlays: a centered box over a
// dimmed backdrop, Esc closes, a click outside closes.

let overlay = null;
let titleEl = null;
let statusEl = null;
let bodyEl = null;

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.id = 'diff-overlay';
  overlay.className = 'hidden';
  const box = document.createElement('div');
  box.id = 'diff-box';
  const head = document.createElement('div');
  head.id = 'diff-head';
  titleEl = document.createElement('span');
  titleEl.id = 'diff-title';
  statusEl = document.createElement('span');
  statusEl.id = 'diff-status';
  head.appendChild(titleEl);
  head.appendChild(statusEl);
  bodyEl = document.createElement('div');
  bodyEl.id = 'diff-body';
  box.appendChild(head);
  box.appendChild(bodyEl);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeDiff();
  });
}

export function isDiffOpen() {
  return !!overlay && !overlay.classList.contains('hidden');
}

export function closeDiff() {
  if (overlay) overlay.classList.add('hidden');
}

export async function openDiff(p) {
  const file = p || (activePane() ? activePane().path : null);
  if (!file) return;
  ensureOverlay();
  titleEl.textContent = baseName(file);
  titleEl.title = file;
  statusEl.textContent = 'reading the diff...';
  bodyEl.innerHTML = '';
  overlay.classList.remove('hidden');
  let res = null;
  try {
    res = await window.wired.gitDiff(file);
  } catch {
    res = null;
  }
  if (!isDiffOpen()) return; // closed while git was answering
  if (!res || !res.ok) {
    // Not a repository, or no git: the overlay says so and stays out of the way.
    statusEl.textContent = 'this file is not inside a git repository';
    return;
  }
  const lines = res.lines || [];
  const added = lines.filter((l) => l.type === 'add').length;
  const removed = lines.filter((l) => l.type === 'del').length;
  if (lines.length === 0) {
    statusEl.textContent = 'no change against the index';
    return;
  }
  statusEl.textContent =
    (res.untracked ? 'untracked, whole file as added: ' : '') +
    '+' + added + ' / -' + removed +
    (res.truncated ? ' (list truncated)' : '');
  const frag = document.createDocumentFragment();
  for (const l of lines) {
    const row = document.createElement('div');
    row.className = 'diff-line diff-' + l.type;
    const sign = document.createElement('span');
    sign.className = 'diff-sign';
    sign.textContent = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
    const text = document.createElement('span');
    text.className = 'diff-text';
    text.textContent = l.text;
    row.appendChild(sign);
    row.appendChild(text);
    frag.appendChild(row);
  }
  bodyEl.appendChild(frag);
  bodyEl.scrollTop = 0;
}

// Esc closes the diff before anything else looks at the key. The listener only
// acts while the overlay is open, so the rest of the Escape chain in app.js is
// untouched.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || !isDiffOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    closeDiff();
  },
  true
);

// The palette action is registered through a DYNAMIC import on purpose. The
// tree imports this module and the palette imports the tree, so a static import
// here would close a cycle and force the palette to evaluate in the middle of
// the tree's own instantiation. Asking for it after the fact costs nothing and
// keeps the module graph acyclic.
import('./palette.js').then((palette) => {
  palette.registerPaletteAction({ label: 'view file diff', run: () => openDiff() });
});

// --- surface the end to end suite drives this through ---

window.gitRefresh = refreshGitNow;
window.gitStateFor = gitStateFor;
window.openDiff = openDiff;
window.closeDiff = closeDiff;
window.isDiffOpen = isDiffOpen;
Object.defineProperty(window, 'gitRepoRoot', { get: () => repoRoot });
