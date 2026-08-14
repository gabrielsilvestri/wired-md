// Full text search inside the folder of the open note (Ctrl+Shift+F). The quick
// switcher finds by NAME; this one finds by CONTENT. Results are grouped by
// file, the arrows walk every match, Enter opens in the active pane and
// Ctrl+Enter opens beside.

import { baseName, activePane } from './state.js';
import { svgIcon, ICON_FILE } from './icons.js';
import { openPath } from './panes.js';
import { getTreeRoot } from './tree.js';
import { closePalette, isPaletteOpen } from './palette.js';

const searchOverlay = document.getElementById('search-overlay');
const searchInput = document.getElementById('search-input');
const searchStatus = document.getElementById('search-status');
const searchResults = document.getElementById('search-results');

const SEARCH_MIN_CHARS = 2;

let searchHits = []; // flat list of the matches on screen: { path, line, text, start, end }
let searchSel = 0;
let searchTimer = null;
let searchSeq = 0; // drops a stale response that lands after a newer one

export function getSearchHits() {
  return searchHits;
}

export function getSearchSel() {
  return searchSel;
}

export function isSearchOpen() {
  return !searchOverlay.classList.contains('hidden');
}

export function openSearch() {
  if (isPaletteOpen()) closePalette();
  searchOverlay.classList.remove('hidden');
  searchInput.focus();
  searchInput.select();
  if (searchInput.value.trim().length >= SEARCH_MIN_CHARS) runSearch();
  else {
    searchStatus.textContent = 'type at least ' + SEARCH_MIN_CHARS + ' characters';
    searchResults.innerHTML = '';
    searchHits = [];
  }
}

export function closeSearch() {
  searchOverlay.classList.add('hidden');
  clearTimeout(searchTimer);
}

async function runSearch() {
  const q = searchInput.value.trim();
  if (q.length < SEARCH_MIN_CHARS) {
    searchHits = [];
    searchResults.innerHTML = '';
    searchStatus.textContent = 'type at least ' + SEARCH_MIN_CHARS + ' characters';
    return;
  }
  const root = getTreeRoot();
  if (!root) {
    searchStatus.textContent = 'no folder open';
    return;
  }
  const seq = ++searchSeq;
  searchStatus.textContent = 'searching in ' + baseName(root) + '...';
  const res = await window.wired.searchFolder(root, q);
  if (seq !== searchSeq) return; // arrived out of order
  if (!res.ok) {
    searchStatus.textContent = 'the search failed: ' + (res.error || 'unknown error');
    searchResults.innerHTML = '';
    searchHits = [];
    return;
  }
  renderSearch(res);
}

function renderSearch(res) {
  searchResults.innerHTML = '';
  searchHits = [];
  const files = res.files || [];
  const total = res.total || 0;
  const root = getTreeRoot();
  if (files.length === 0) {
    searchStatus.textContent = 'nothing found in ' + baseName(root);
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'nothing found';
    searchResults.appendChild(empty);
    return;
  }
  searchStatus.textContent =
    total + (total === 1 ? ' result' : ' results') + ' in ' + files.length + (files.length === 1 ? ' file' : ' files') + (res.truncated ? ' (list truncated)' : '');
  for (const f of files) {
    const head = document.createElement('div');
    head.className = 'search-file';
    head.title = f.path;
    const ico = svgIcon(12, ICON_FILE);
    ico.classList.add('tree-ico');
    const name = document.createElement('span');
    name.textContent = f.name;
    const count = document.createElement('span');
    count.className = 'search-file-count';
    count.textContent = f.matches.length;
    head.appendChild(ico);
    head.appendChild(name);
    head.appendChild(count);
    searchResults.appendChild(head);
    for (const m of f.matches) {
      const hit = { path: f.path, line: m.line, text: m.text, start: m.start, end: m.end };
      const idx = searchHits.length;
      searchHits.push(hit);
      const row = document.createElement('div');
      row.className = 'search-line';
      const no = document.createElement('span');
      no.className = 'search-lineno';
      no.textContent = m.line;
      const txt = document.createElement('span');
      txt.className = 'search-text';
      txt.appendChild(document.createTextNode(m.text.slice(0, m.start)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = m.text.slice(m.start, m.end);
      txt.appendChild(mark);
      txt.appendChild(document.createTextNode(m.text.slice(m.end)));
      row.appendChild(no);
      row.appendChild(txt);
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        searchSel = idx;
        openSearchHit(hit, e.ctrlKey);
      });
      searchResults.appendChild(row);
    }
  }
  searchSel = 0;
  markSearchSel();
}

function markSearchSel() {
  const rows = searchResults.querySelectorAll('.search-line');
  rows.forEach((r, i) => r.classList.toggle('selected', i === searchSel));
  const sel = rows[searchSel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function moveSearchSel(delta) {
  if (searchHits.length === 0) return;
  searchSel = (searchSel + delta + searchHits.length) % searchHits.length;
  markSearchSel();
}

async function openSearchHit(hit, side) {
  closeSearch();
  await openPath(hit.path, !!side);
  jumpToText(hit.text.slice(hit.start, hit.end));
}

// Jumping to the snippet is BEST EFFORT, and the limit is real. Vditor in IR
// mode is WYSIWYG, so what is on screen is not the line in the file: table,
// link, heading and code syntax become DOM that differs from the raw text, and
// not every match on disk exists as contiguous text in the rendered document.
// When the snippet is found it is selected and scrolled into view; when it is
// not (or when it fell inside transformed markup) the file simply opens at the
// top, with no error. There is no "go to line N" API in Vditor IR.
function jumpToText(snippet) {
  const target = (snippet || '').trim();
  if (!target) return;
  setTimeout(() => {
    const pane = activePane();
    if (!pane || !pane.el) return;
    const root = pane.el.querySelector('.vditor-ir .vditor-reset');
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.nodeValue.indexOf(target);
      if (i === -1) continue;
      try {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + target.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const el = node.parentElement;
        if (el) el.scrollIntoView({ block: 'center' });
      } catch {}
      return;
    }
  }, 260);
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 200);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSearchSel(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSearchSel(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const hit = searchHits[searchSel];
    if (hit) openSearchHit(hit, e.ctrlKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
  e.stopPropagation();
});

searchOverlay.addEventListener('mousedown', (e) => {
  if (e.target === searchOverlay) closeSearch();
});
