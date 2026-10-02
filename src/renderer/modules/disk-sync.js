// An open note follows its file on disk.
//
// Agents edit the same files this editor has open (claude in the embedded
// terminal rewriting CLAUDE.md, anything driven through the wired CLI), so a
// pane that kept its old text would let the next Ctrl+S silently erase what the
// other tool wrote. Main watches every open file (src/main/ipc/filewatch.js) and
// reports what is on disk; this module decides what that means for the pane:
//
//   clean pane          reload in place, keeping scroll and caret, never dirty
//   pane with edits     an inline amber row: reload from disk, or keep mine
//   file gone           an inline row; the tab stays and saving recreates it
//
// Per pane, `disk.base` is the raw text last read from or written to disk (NOT
// the editor value, which Vditor normalizes). A change equal to the base is our
// own save echoing back, or a touch, and is ignored.

import { panes } from './state.js';
import { svgIcon, ICON_ALERT } from './icons.js';
import { setPaneDirty } from './panes.js';
import { refreshFmPanel } from './frontmatter.js';
import { applyFocusMode, scrollContainerOf } from './focus-typewriter.js';

// lucide file-x, for the row of a file that left the disk.
const ICON_FILE_GONE = ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'm14.5 12.5-5 5', 'm9.5 12.5 5 5'];

let reloads = 0; // observable by the E2E: an own save must never count here

export function getDiskReloads() {
  return reloads;
}

function stateOf(pane) {
  if (!pane.disk) pane.disk = { base: null, writing: null, pending: null, gone: false, rowEl: null };
  return pane.disk;
}

function samePath(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

// --- the watched set ---

let syncTimer = null;

// Hands main the full list of open files. Always sent, even when the list did
// not change: main re-arms a folder watcher that died with its folder.
export function syncWatches() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const list = [...new Set(panes.map((p) => p.path).filter(Boolean))];
    window.wired.watchFiles(list);
  }, 0);
}

// --- hook points called by panes.js ---

export function diskOpened(pane, content) {
  const st = stateOf(pane);
  st.base = content;
  st.writing = null;
  st.pending = null;
  st.gone = false;
  renderRow(pane);
  syncWatches();
}

export function diskSaved(pane, content) {
  diskOpened(pane, content);
}

// Runs before every save of a file that has a path. Returns true when writing is
// safe. Ctrl+S with a conflict still on screen does NOT write: the row pulses
// and waits, because the only honest ways out are its two buttons ("keep mine"
// is the explicit overwrite, and after it the same Ctrl+S goes through).
export async function diskSaveGuard(pane, content) {
  const st = stateOf(pane);
  st.writing = null;
  if (st.pending !== null) {
    renderRow(pane, true);
    return false;
  }
  const res = st.base === null ? null : await window.wired.readForSync(pane.path);
  // A missing file is the "gone" case: saving recreates it. An unreadable one
  // is left to the write, which reports its own error.
  if (!res || !res.ok || !res.exists || res.content === st.base) {
    // What is about to be written: if the watcher reports it before the write
    // call returns, it is still our own save and not a conflict.
    st.writing = content;
    return true;
  }
  // The disk moved since we last read or wrote it, and the watcher has not told
  // us yet (or could not): same conflict, found at the last moment. Re-arming
  // the watchers is the right answer to a watcher that may have missed it.
  st.pending = res.content;
  st.gone = false;
  renderRow(pane, true);
  syncWatches();
  return false;
}

// --- reacting to the disk ---

function editorRoot(pane) {
  return pane.el.querySelector('.vditor-ir .vditor-reset');
}

// Caret as a character offset into the editor text, so it can be put back after
// setValue rebuilds every block.
function caretOffset(root) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return -1;
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length;
}

function placeCaret(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    last = n;
    if (left <= n.length) {
      window.getSelection().collapse(n, left);
      return;
    }
    left -= n.length;
  }
  if (last) window.getSelection().collapse(last, last.length);
}

// A clean pane takes the new text in place. setValue rebuilds the DOM and drops
// the caret, so the reader is put back where they were: the scroll offset, and
// the caret only when this editor had the focus (it never takes the focus from
// somewhere else, the terminal included).
function reloadInPlace(pane, content) {
  const st = stateOf(pane);
  const root = editorRoot(pane);
  const scroller = root ? scrollContainerOf(root, pane) || root : null;
  const top = scroller ? scroller.scrollTop : 0;
  const hadFocus = !!root && root.contains(document.activeElement);
  const caret = hadFocus ? caretOffset(root) : -1;

  pane.vditor.setValue(content);
  reloads += 1;
  st.base = content;
  st.pending = null;
  st.gone = false;
  setPaneDirty(pane, false);
  refreshFmPanel(pane);
  applyFocusMode();
  renderRow(pane);

  const after = editorRoot(pane);
  if (after && hadFocus && caret >= 0) placeCaret(after, caret);
  // Restored last: placing a caret scrolls it into view.
  const sc = after ? scrollContainerOf(after, pane) || after : null;
  if (sc) sc.scrollTop = Math.min(top, Math.max(0, sc.scrollHeight - sc.clientHeight));
}

function onDiskChange(info) {
  if (!info || !info.path) return;
  for (const pane of panes) {
    if (!pane.ready || !samePath(pane.path, info.path)) continue;
    const st = stateOf(pane);
    if (!info.exists) {
      st.gone = true;
      st.pending = null; // nothing left on disk to reload from
      renderRow(pane);
      continue;
    }
    st.gone = false;
    if (info.content === st.base || info.content === st.writing) {
      // Our own save, or the disk went back to what we had: nothing to decide.
      st.pending = null;
      renderRow(pane);
      continue;
    }
    if (!pane.dirty) reloadInPlace(pane, info.content);
    else {
      st.pending = info.content;
      renderRow(pane);
    }
  }
}

// --- the two ways out of a conflict ---

export function reloadFromDisk(pane) {
  const st = stateOf(pane);
  if (st.pending === null) return;
  reloadInPlace(pane, st.pending);
  // The button that had the focus went away with the row.
  if (pane.vditor && pane.ready) pane.vditor.focus();
}

// The editor text wins: the disk version is acknowledged as seen (it becomes the
// base), the pane stays dirty and the next save writes over it. Not a lasting
// flag: a later external write raises the row again.
export function keepMine(pane) {
  const st = stateOf(pane);
  if (st.pending === null) return;
  st.base = st.pending;
  st.pending = null;
  renderRow(pane);
  if (pane.vditor && pane.ready) pane.vditor.focus();
}

// --- the inline row ---
// Same family as the frontmatter warning: amber ink (--warn-ink) over the pane
// surface, never a popup, never in the way of typing.

function rowButton(cls, label, title, onClick) {
  const b = document.createElement('button');
  b.className = 'disk-btn ' + cls;
  b.textContent = label;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function renderRow(pane, pulse) {
  const st = stateOf(pane);
  const mode = st.pending !== null ? 'conflict' : st.gone ? 'gone' : null;
  if (!mode) {
    if (st.rowEl) st.rowEl.remove();
    st.rowEl = null;
    pane.el.classList.remove('disk-conflict', 'disk-gone');
    return;
  }
  let row = st.rowEl;
  if (!row || row.dataset.mode !== mode) {
    if (row) row.remove();
    row = document.createElement('div');
    row.className = 'disk-row disk-' + mode;
    row.dataset.mode = mode;
    row.setAttribute('role', 'status');
    const ico = svgIcon(13, mode === 'gone' ? ICON_FILE_GONE : ICON_ALERT);
    ico.classList.add('disk-ico');
    const txt = document.createElement('span');
    txt.className = 'disk-msg';
    // Icon and sentence wrap as one unit, so the icon never sits alone on a
    // line of its own in a narrow group.
    const lead = document.createElement('span');
    lead.className = 'disk-lead';
    lead.appendChild(ico);
    lead.appendChild(txt);
    row.appendChild(lead);
    if (mode === 'conflict') {
      txt.textContent = 'This file changed on disk while you were editing. Saving waits until you choose.';
      const actions = document.createElement('span');
      actions.className = 'disk-actions';
      actions.appendChild(rowButton('disk-reload', 'Reload from disk', 'Reload from disk (drops your unsaved edits)', () => reloadFromDisk(pane)));
      actions.appendChild(rowButton('disk-keep', 'Keep mine', 'Keep mine (the next save overwrites the file on disk)', () => keepMine(pane)));
      row.appendChild(actions);
    } else {
      txt.textContent = 'This file is no longer on disk (deleted or renamed). Saving recreates it.';
    }
    pane.el.insertBefore(row, pane.fmEl);
    st.rowEl = row;
  }
  pane.el.classList.toggle('disk-conflict', mode === 'conflict');
  pane.el.classList.toggle('disk-gone', mode === 'gone');
  if (pulse) {
    row.classList.remove('pulse');
    void row.offsetWidth; // restart the animation
    row.classList.add('pulse');
  }
}

window.wired.onFileChanged(onDiskChange);
