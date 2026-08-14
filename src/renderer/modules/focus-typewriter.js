// Focus mode and typewriter mode: the identity of an editor built for writing.
//
// FOCUS: every block except the caret's fades. The opacity comes from the
// theme's --focus-dim, measured so faded text never drops below 4.5:1 (0.62 in
// wired, 0.76 in the light theme). It applies only to the ACTIVE pane; the
// others stay normal, otherwise the whole screen would go dark.
//
// TYPEWRITER: the line being edited stays vertically centered. Scrolling is a
// direct scrollTop assignment on the pane's scroll container with a short
// easing; scrollIntoView was rejected because it scrolls EVERY scrollable
// ancestor, and here the ancestor is the horizontal pane strip (the screen would
// slide sideways).
//
// Both react to the caret and to typing only (selectionchange and the Vditor
// input callback). Nothing happens on the mouse wheel or the scrollbar: whoever
// scrolls by hand stays where they stopped until the caret moves again.

import { config, saveConfig, registerConfigDefaults, panes, activePane, getActivePaneId } from './state.js';

registerConfigDefaults({ focusMode: false, typewriterMode: false });

function paneEditorRoot(pane) {
  return pane && pane.el ? pane.el.querySelector('.vditor-ir .vditor-reset') : null;
}

// Walks up from the caret node to the DIRECT child of .vditor-reset (the top
// level block: paragraph, heading, whole list, table, image, fenced code).
function topBlockOf(root, node) {
  let n = node;
  if (n && n.nodeType === 3) n = n.parentElement;
  while (n && n.parentElement && n.parentElement !== root) n = n.parentElement;
  return n && n.parentElement === root ? n : null;
}

export function caretBlock(pane) {
  const root = paneEditorRoot(pane);
  if (!root) return null;
  const sel = window.getSelection ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
  if (!root.contains(sel.anchorNode)) return null;
  return topBlockOf(root, sel.anchorNode);
}

// The container that scrolls inside the pane (Vditor decides where the overflow lives).
export function scrollContainerOf(el, pane) {
  let n = el;
  while (n && n !== pane.el) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
    n = n.parentElement;
  }
  return null;
}

function clearFocusMarks(pane) {
  const root = paneEditorRoot(pane);
  if (!root) return;
  for (const el of Array.from(root.children)) el.classList.remove('focus-current');
}

function updateFocusMarker() {
  if (!config.focusMode) return;
  const pane = activePane();
  if (!pane) return;
  const root = paneEditorRoot(pane);
  if (!root) return;
  const block = caretBlock(pane);
  // Caret outside the editor (palette, properties panel, terminal): the previous
  // marker stays where it is, otherwise the whole document would fade.
  if (!block) return;
  for (const el of Array.from(root.children)) el.classList.toggle('focus-current', el === block);
}

let twAnim = null;

// Short easing (120ms) over scrollTop: smooth enough not to jump, cheap enough
// not to fight someone typing fast.
function easeScrollTop(cont, destination) {
  if (twAnim) cancelAnimationFrame(twAnim);
  const start = cont.scrollTop;
  const dist = destination - start;
  if (Math.abs(dist) < 1) {
    cont.scrollTop = destination;
    twAnim = null;
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 120);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    cont.scrollTop = start + dist * e;
    twAnim = k < 1 ? requestAnimationFrame(step) : null;
  };
  twAnim = requestAnimationFrame(step);
}

function centerCaretLine() {
  if (!config.typewriterMode) return;
  const pane = activePane();
  if (!pane) return;
  const block = caretBlock(pane);
  if (!block) return;
  const cont = scrollContainerOf(block, pane);
  if (!cont) return;
  let target = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    // An empty line gives a zeroed rect: then the block is the reference.
    if (r && (r.height > 0 || r.top > 0)) target = r.top + r.height / 2;
  }
  if (target === null) {
    const rb = block.getBoundingClientRect();
    target = rb.top + rb.height / 2;
  }
  const rc = cont.getBoundingClientRect();
  const delta = target - (rc.top + rc.height / 2);
  if (Math.abs(delta) < 2) return;
  const max = Math.max(0, cont.scrollHeight - cont.clientHeight);
  easeScrollTop(cont, Math.max(0, Math.min(max, cont.scrollTop + delta)));
}

// One frame of waiting collapses the flood of selectionchange events a single
// keystroke produces.
let caretTick = null;

export function caretMoved() {
  if (!config.focusMode && !config.typewriterMode) return;
  if (caretTick) return;
  caretTick = requestAnimationFrame(() => {
    caretTick = null;
    updateFocusMarker();
    centerCaretLine();
  });
}

document.addEventListener('selectionchange', caretMoved);

export function applyFocusMode() {
  for (const p of panes) {
    const on = !!config.focusMode && p.id === getActivePaneId();
    p.el.classList.toggle('focus-mode', on);
    if (!on) clearFocusMarks(p);
  }
  updateFocusMarker();
}

export function applyTypewriterMode() {
  for (const p of panes) p.el.classList.toggle('typewriter-mode', !!config.typewriterMode && p.id === getActivePaneId());
  centerCaretLine();
}

export function toggleFocusMode(forceOn) {
  config.focusMode = forceOn === undefined ? !config.focusMode : !!forceOn;
  saveConfig();
  applyFocusMode();
}

export function toggleTypewriterMode(forceOn) {
  config.typewriterMode = forceOn === undefined ? !config.typewriterMode : !!forceOn;
  saveConfig();
  applyTypewriterMode();
}
