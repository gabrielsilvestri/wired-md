// Links that go somewhere, images that render, and images that arrive.
//
// Ctrl+click on a link: http, https and mailto go to the default browser (main
// validates the scheme again), a path to a Markdown note opens it in a tab, a
// #anchor scrolls to the heading. Relative images render through the Lute link
// base (the Markdown on disk is never touched). A pasted or dropped image is
// written next to the note under assets/ and linked at the caret; a dropped
// .md file opens in a tab instead of becoming text.

import { panes, activePane } from './state.js';
import { openPath, setPaneDirty } from './panes.js';
import { svgIcon, ICON_ALERT } from './icons.js';

const panesEl = document.getElementById('panes');
const HINT = 'Ctrl+click to open';

// --- the inline status row (a pane level message, never a popup) ---

const statusTimers = new WeakMap();

export function paneStatus(pane, msg) {
  if (!pane || !pane.el) return;
  for (const old of pane.el.querySelectorAll(':scope > .pane-status')) old.remove();
  clearTimeout(statusTimers.get(pane));
  const row = document.createElement('div');
  row.className = 'pane-status';
  row.setAttribute('role', 'status');
  const ico = svgIcon(12, ICON_ALERT);
  ico.classList.add('pane-status-ico');
  const txt = document.createElement('span');
  txt.textContent = msg;
  row.appendChild(ico);
  row.appendChild(txt);
  // Right under the header, above the properties panel and the editor.
  const header = pane.el.querySelector(':scope > .pane-header');
  pane.el.insertBefore(row, header ? header.nextSibling : pane.el.firstChild);
  statusTimers.set(pane, setTimeout(() => row.remove(), 6000));
}

function paneOf(node) {
  const el = node && node.closest ? node.closest('.pane') : null;
  return (el && panes.find((p) => p.el === el)) || null;
}

// --- relative images: the Lute link base ---

function dirUrl(notePath) {
  const dir = notePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const enc = encodeURI(dir).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return (enc.startsWith('/') ? 'file://' : 'file:///') + enc + '/';
}

// Points the pane's Lute at the folder of its note. Vditor resolves an image
// src against index.html otherwise, and `assets/pic.png` next to the note
// breaks. Lute only changes the rendered src: the marker text, and so the
// Markdown, stays as written. Images already on screen (a note that was just
// saved under a new name) are re-pointed in the DOM; no value is rewritten.
export function applyLinkBase(pane) {
  const lute = pane && pane.vditor && pane.vditor.vditor && pane.vditor.vditor.lute;
  if (!lute || typeof lute.SetLinkBase !== 'function') return;
  const base = pane.path ? dirUrl(pane.path) : '';
  lute.SetLinkBase(base);
  if (!base || !pane.el) return;
  for (const node of pane.el.querySelectorAll('.vditor-ir [data-type="img"]')) {
    const marker = node.querySelector(':scope > .vditor-ir__marker--link');
    const img = node.querySelector(':scope > img');
    const rel = marker ? marker.textContent : '';
    if (!img || !rel || /^([a-z][a-z0-9+.-]+:|\/|[a-z]:[\\/])/i.test(rel)) continue;
    // The marker is the Markdown as written, often already percent encoded (a
    // pasted image's link is): decode first so a % is never encoded twice.
    let plain = rel;
    try { plain = decodeURI(rel); } catch {}
    img.setAttribute('src', base + encodeURI(plain));
  }
}

// --- links ---

// The destination of the link under the pointer, or null.
export function linkTarget(el) {
  const node = el.closest('[data-type="a"], [data-type="link-ref"]');
  if (node) {
    const dest = node.querySelectorAll(':scope > .vditor-ir__marker--link');
    if (dest.length) return dest[dest.length - 1].textContent.trim();
    const text = node.querySelector(':scope > .vditor-ir__link');
    if (text) return text.textContent.trim();
  }
  const a = el.closest('a[href]');
  return a ? a.getAttribute('href') : null;
}

const slug = (s) => String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');

// Scrolls the pane to the heading a #fragment names (GitHub style slugs, with
// -1, -2 for repeats). Returns false when nothing matches.
export function scrollToHeading(pane, fragment) {
  let want = fragment;
  try {
    want = decodeURIComponent(fragment);
  } catch {}
  want = slug(want);
  if (!want || !pane || !pane.el) return false;
  const seen = {};
  for (const h of pane.el.querySelectorAll('.vditor-ir .vditor-reset h1, .vditor-ir .vditor-reset h2, .vditor-ir .vditor-reset h3, .vditor-ir .vditor-reset h4, .vditor-ir .vditor-reset h5, .vditor-ir .vditor-reset h6')) {
    const marker = h.querySelector('.vditor-ir__marker--heading');
    const text = h.textContent.slice(marker ? marker.textContent.length : 0);
    const base = slug(text);
    const n = seen[base] || 0;
    seen[base] = n + 1;
    if ((n ? base + '-' + n : base) === want) {
      h.scrollIntoView({ block: 'start' });
      return true;
    }
  }
  return false;
}

async function scrollWhenReady(pane, fragment) {
  const started = Date.now();
  while (Date.now() - started < 800) {
    if (scrollToHeading(pane, fragment)) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  paneStatus(pane, 'No heading matches #' + fragment);
}

export async function followLink(pane, target) {
  const t = String(target || '').trim();
  if (!t) return;
  if (/^(https?|mailto):/i.test(t)) {
    const res = await window.wired.openExternal(t);
    if (!res || !res.ok) paneStatus(pane, 'This link could not be opened');
    return;
  }
  if (t.startsWith('#')) {
    if (!scrollToHeading(pane, t.slice(1))) paneStatus(pane, 'No heading matches ' + t);
    return;
  }
  // Any other scheme (javascript:, data:, ftp:) goes nowhere. A Windows drive
  // letter is not a scheme.
  if (/^[a-z][a-z0-9+.-]+:/i.test(t) && !/^file:/i.test(t)) {
    paneStatus(pane, 'This kind of link does not open from here');
    return;
  }
  const res = await window.wired.resolveLink(pane.path || '', t);
  if (!res || !res.ok) {
    paneStatus(pane, (res && res.error === 'file not found' ? 'Note not found: ' : 'Cannot open: ') + (res && res.path ? res.path : t) + (res && res.error !== 'file not found' ? ' (' + res.error + ')' : ''));
    return;
  }
  await openPath(res.path);
  if (res.hash) await scrollWhenReady(activePane(), res.hash);
}

panesEl.addEventListener(
  'click',
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;
    const target = e.target.closest ? linkTarget(e.target) : null;
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const pane = paneOf(e.target);
    if (pane) void followLink(pane, target);
  },
  true
);

// The tooltip says how to follow a link; it is set where the pointer lands, so
// a node Vditor re-rendered gets it again.
panesEl.addEventListener('mouseover', (e) => {
  const node = e.target.closest ? e.target.closest('[data-type="a"], [data-type="link-ref"]') : null;
  if (node && !node.title) node.title = HINT;
});

// With Ctrl held a link looks clickable (the cursor), without it stays text.
const ctrlClass = (on) => document.body.classList.toggle('ctrl-down', on);
window.addEventListener('keydown', (e) => e.key === 'Control' && ctrlClass(true), true);
window.addEventListener('keyup', (e) => e.key === 'Control' && ctrlClass(false), true);
window.addEventListener('blur', () => ctrlClass(false));

// --- pasted and dropped images ---

export async function insertImageFiles(pane, files) {
  if (!pane || !pane.vditor) return;
  if (!pane.path) {
    paneStatus(pane, 'Save the note first, then the image can be added next to it');
    return;
  }
  const lines = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const res = await window.wired.savePastedImage(pane.path, f.type, bytes);
    if (!res || !res.ok) {
      paneStatus(pane, 'Could not save the image: ' + (res && res.error));
      continue;
    }
    lines.push('![](' + encodeURI(res.rel) + ')');
  }
  if (!lines.length) return;
  pane.vditor.insertValue(lines.join('\n'));
  setPaneDirty(pane, true);
}

const isImage = (f) => /^image\//i.test(f.type);
const hasFiles = (e) => !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1;

// Files dropped on the window: a Markdown note opens in a tab, an image goes
// next to the note under the pointer (or the active one). `pathOf` is injected
// so a test can drive this without a real OS drag.
export async function handleDroppedFiles(files, pathOf, pane) {
  const images = [];
  for (const f of files) {
    const p = pathOf(f);
    if (p && /\.(md|markdown)$/i.test(p)) await openPath(p);
    else if (isImage(f)) images.push(f);
  }
  if (images.length) await insertImageFiles(pane || activePane(), images);
}

window.addEventListener('dragover', (e) => {
  // Without this the browser would navigate to the dropped file.
  if (hasFiles(e)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}, true);

window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.stopPropagation();
  void handleDroppedFiles([...e.dataTransfer.files], (f) => window.wired.pathForFile(f), paneOf(e.target));
}, true);

panesEl.addEventListener(
  'paste',
  (e) => {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isImage);
    if (!files.length) return; // text paste stays Vditor's
    e.preventDefault();
    e.stopPropagation();
    void insertImageFiles(paneOf(e.target), files);
  },
  true
);

// The seam the end to end suite drives (a real OS drag cannot be synthesized).
window.wiredLinks = { followLink, scrollToHeading, handleDroppedFiles, insertImageFiles, paneStatus };
