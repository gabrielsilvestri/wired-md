// Spreadsheet style editing for markdown pipe tables.
//
// Two halves:
//
// 1. NAVIGATION. Tab, Shift+Tab and Enter walk the cells the way a spreadsheet
//    does. This is pure caret movement in the DOM, so it costs nothing and can
//    never touch the document. The one exception is Tab on the last cell, which
//    runs the "add row below" transform first.
//
// 2. TRANSFORMS. Add and delete rows and columns, move them around, set the
//    alignment of a column. A transform is expressed on the MARKDOWN of the
//    table block: the block is located in getValue(), parsed as a pipe table,
//    rewritten, and then rendered back into a fresh table node that REPLACES the
//    old one in place.
//
// Why replace one node instead of setValue() on the whole document: Lute
// normalizes what it re-parses (the blank line after the frontmatter is the
// known casualty), so re-parsing the whole file to change three characters in a
// table would quietly rewrite bytes nobody asked to touch. Swapping a single
// node leaves the rest of the document DOM exactly as it was.
//
// THE ROUND TRIP GUARD makes that a promise instead of a hope: every transform
// snapshots getValue() before, and after the swap the new getValue() has to
// start with the same prefix and end with the same suffix as the old one. What
// changed is only what sits between them, which is the table block. When the
// guard trips, the original node is put back and nothing was written.

import { panes, activePane } from './state.js';
import { svgIcon } from './icons.js';
import { setPaneDirty } from './panes.js';
import { registerPaletteAction } from './palette.js';

// --- markdown side: finding, parsing and printing a pipe table ---

// Splits a table line into trimmed cells. A pipe escaped as \| belongs to the
// cell, so it is not a separator.
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (/(?:^|[^\\])\|$/.test(s) || s === '|') s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

function isDelimiterLine(line) {
  if (line.indexOf('|') === -1 && line.indexOf('-') === -1) return false;
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

function alignOf(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

const DELIM = { '': '---', left: ':---', center: ':---:', right: '---:' };

// Every pipe table in the document text, in document order, with the character
// range it occupies. Fenced code is skipped: a table drawn inside ``` is text.
export function scanTables(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const offsets = [];
  let off = 0;
  for (const l of lines) {
    offsets.push(off);
    off += l.length + 1;
  }
  const found = [];
  let fence = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fenceMark = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMark && fenceMark[1][0] === fence) fence = null;
      i += 1;
      continue;
    }
    if (fenceMark) {
      fence = fenceMark[1][0];
      i += 1;
      continue;
    }
    const next = i + 1 < lines.length ? lines[i + 1] : null;
    if (
      line.indexOf('|') !== -1 &&
      line.trim() !== '' &&
      next !== null &&
      isDelimiterLine(next) &&
      splitRow(line).length === splitRow(next).length
    ) {
      let end = i + 2;
      while (end < lines.length && lines[end].trim() !== '' && lines[end].indexOf('|') !== -1) end += 1;
      found.push({
        start: offsets[i],
        end: offsets[end - 1] + lines[end - 1].length,
        text: lines.slice(i, end).join('\n')
      });
      i = end;
      continue;
    }
    i += 1;
  }
  return found;
}

// { rows, aligns }: rows[0] is the header, the rest is the body. Every row is
// padded to the width the delimiter line declares, so the grid is rectangular.
export function parseTable(block) {
  const lines = String(block).split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const aligns = splitRow(lines[1]).map(alignOf);
  const width = aligns.length;
  const fit = (cells) => {
    const out = cells.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  };
  const rows = [fit(splitRow(lines[0]))];
  for (let i = 2; i < lines.length; i++) rows.push(fit(splitRow(lines[i])));
  return { rows, aligns };
}

export function printTable(table) {
  const line = (cells) => '| ' + cells.map((c) => (c === '' ? ' ' : c)).join(' | ') + ' |';
  const out = [line(table.rows[0]), '| ' + table.aligns.map((a) => DELIM[a] || DELIM['']).join(' | ') + ' |'];
  for (let i = 1; i < table.rows.length; i++) out.push(line(table.rows[i]));
  return out.join('\n');
}

// --- the transforms, all pure: (table, row, col) becomes a new table ---
// Row 0 is the header. It is never deleted, never moved and nothing is inserted
// above it: a pipe table without a header row is not a table.

const blankRow = (n) => new Array(n).fill('');

export const TRANSFORMS = {
  rowAbove: (t, row) => {
    const at = Math.max(1, row);
    t.rows.splice(at, 0, blankRow(t.aligns.length));
    return { row: at, col: null };
  },
  rowBelow: (t, row) => {
    const at = Math.max(1, row + 1);
    t.rows.splice(at, 0, blankRow(t.aligns.length));
    return { row: at, col: null };
  },
  rowDelete: (t, row) => {
    if (row < 1 || t.rows.length <= 2) return null;
    t.rows.splice(row, 1);
    return { row: Math.min(row, t.rows.length - 1), col: null };
  },
  rowUp: (t, row) => {
    if (row < 2) return null;
    const [r] = t.rows.splice(row, 1);
    t.rows.splice(row - 1, 0, r);
    return { row: row - 1, col: null };
  },
  rowDown: (t, row) => {
    if (row < 1 || row >= t.rows.length - 1) return null;
    const [r] = t.rows.splice(row, 1);
    t.rows.splice(row + 1, 0, r);
    return { row: row + 1, col: null };
  },
  colLeft: (t, row, col) => {
    for (const r of t.rows) r.splice(col, 0, '');
    t.aligns.splice(col, 0, '');
    return { row: null, col };
  },
  colRight: (t, row, col) => {
    for (const r of t.rows) r.splice(col + 1, 0, '');
    t.aligns.splice(col + 1, 0, '');
    return { row: null, col: col + 1 };
  },
  colDelete: (t, row, col) => {
    if (t.aligns.length <= 1) return null;
    for (const r of t.rows) r.splice(col, 1);
    t.aligns.splice(col, 1);
    return { row: null, col: Math.min(col, t.aligns.length - 1) };
  },
  colMoveLeft: (t, row, col) => {
    if (col < 1) return null;
    for (const r of t.rows) r.splice(col - 1, 0, r.splice(col, 1)[0]);
    t.aligns.splice(col - 1, 0, t.aligns.splice(col, 1)[0]);
    return { row: null, col: col - 1 };
  },
  colMoveRight: (t, row, col) => {
    if (col >= t.aligns.length - 1) return null;
    for (const r of t.rows) r.splice(col + 1, 0, r.splice(col, 1)[0]);
    t.aligns.splice(col + 1, 0, t.aligns.splice(col, 1)[0]);
    return { row: null, col: col + 1 };
  },
  alignLeft: (t, row, col) => {
    t.aligns[col] = 'left';
    return { row: null, col };
  },
  alignCenter: (t, row, col) => {
    t.aligns[col] = 'center';
    return { row: null, col };
  },
  alignRight: (t, row, col) => {
    t.aligns[col] = 'right';
    return { row: null, col };
  }
};

// --- DOM side: where is the caret, and which table is that ---

function editorOf(node) {
  const el = node && node.nodeType === 1 ? node : node && node.parentElement;
  return el && el.closest ? el.closest('.vditor-ir .vditor-reset') : null;
}

function paneOf(node) {
  return panes.find((p) => p.el && p.el.contains(node)) || null;
}

function tableRowsOf(table) {
  return Array.prototype.slice.call(table.querySelectorAll('tr'));
}

// The cell the caret sits in, plus everything a command needs around it. Null
// whenever the caret is anywhere else, which is what keeps Tab out of the way in
// the rest of the app.
export function caretCell() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
  const anchor = sel.anchorNode;
  const el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
  if (!el || !el.closest) return null;
  const cell = el.closest('td,th');
  if (!cell) return null;
  const table = cell.closest('table');
  if (!table || !editorOf(table)) return null;
  const pane = paneOf(table);
  if (!pane || !pane.vditor || !pane.ready) return null;
  const rows = tableRowsOf(table);
  const tr = cell.parentElement;
  const row = rows.indexOf(tr);
  const col = Array.prototype.indexOf.call(tr.children, cell);
  if (row === -1 || col === -1) return null;
  return { pane, table, cell, rows, row, col, nRows: rows.length, nCols: rows[0] ? rows[0].children.length : 0 };
}

function cellAt(table, row, col) {
  const rows = tableRowsOf(table);
  const tr = rows[Math.max(0, Math.min(row, rows.length - 1))];
  if (!tr) return null;
  const cells = tr.children;
  return cells[Math.max(0, Math.min(col, cells.length - 1))] || null;
}

function focusCell(cell) {
  if (!cell) return;
  const editor = editorOf(cell);
  if (editor) editor.focus();
  try {
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
  positionToolbar();
}

// --- applying a transform, with the round trip guard ---

let lastGuardTrip = null;

export function getLastGuardTrip() {
  return lastGuardTrip;
}

// Runs `name` on the table the caret is in. Returns true when the document
// changed. Everything that can go wrong (no caret in a table, a transform that
// does not apply, a document Lute would rewrite elsewhere) returns false and
// leaves the file exactly as it was.
export function runTableCommand(name) {
  const fn = TRANSFORMS[name];
  const info = caretCell();
  if (!fn || !info) return false;
  const { pane, table } = info;

  const before = pane.vditor.getValue();
  const blocks = scanTables(before);
  const domTables = Array.prototype.slice.call(editorOf(table).querySelectorAll('table'));
  const index = domTables.indexOf(table);
  // The Nth table on screen is the Nth pipe table in the text only while the two
  // counts agree. A raw HTML table in the document would break the mapping, and
  // then the safe answer is to do nothing.
  if (index === -1 || blocks.length !== domTables.length) return false;
  const block = blocks[index];

  const parsed = parseTable(block.text);
  if (!parsed) return false;
  const target = fn(parsed, info.row, info.col);
  if (!target) return false;
  const nextMd = printTable(parsed);

  const lute = pane.vditor.vditor && pane.vditor.vditor.lute;
  if (!lute || typeof lute.Md2VditorIRDOM !== 'function') return false;
  const holder = document.createElement('div');
  holder.innerHTML = lute.Md2VditorIRDOM(nextMd);
  const fresh = holder.querySelector('table');
  if (!fresh) return false;

  const prefix = before.slice(0, block.start);
  const suffix = before.slice(block.end);
  table.replaceWith(fresh);
  const after = pane.vditor.getValue();
  const intact = after.length >= prefix.length + suffix.length && after.startsWith(prefix) && after.endsWith(suffix);
  if (!intact) {
    // Something outside the table block moved. That is a bug, not a fact of
    // life: put the original node back and write nothing.
    fresh.replaceWith(table);
    lastGuardTrip = { command: name, before: before.slice(0, 80), after: after.slice(0, 80) };
    return false;
  }
  lastGuardTrip = null;

  setPaneDirty(pane, true);
  focusCell(cellAt(fresh, target.row === null ? info.row : target.row, target.col === null ? info.col : target.col));
  return true;
}

// --- navigation ---

function moveByCell(info, delta) {
  const flat = info.row * info.nCols + info.col;
  const total = info.nRows * info.nCols;
  const next = flat + delta;
  // Shift+Tab out of the very first cell has nowhere to go, so it stays put.
  if (next < 0) return;
  if (next >= total) {
    // Tab off the last cell grows the table, the way a spreadsheet does. The
    // caret is on the last cell already, so the transform reads it straight.
    if (delta > 0 && runTableCommand('rowBelow')) {
      const grown = caretCell();
      if (grown) focusCell(cellAt(grown.table, grown.row, 0));
    }
    return;
  }
  focusCell(cellAt(info.table, Math.floor(next / info.nCols), next % info.nCols));
}

// Capture phase, like every other global shortcut here: Vditor swallows keydown
// inside the editor, so a Tab typed in a cell would never arrive otherwise.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Enter' && e.shiftKey) return;
    const info = caretCell();
    if (!info || info.nCols === 0) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      moveByCell(info, e.shiftKey ? -1 : 1);
      return;
    }
    // Enter drops to the row below in the same column. On the last row there is
    // no row below, so Vditor keeps whatever it does today.
    if (info.row + 1 >= info.nRows) return;
    e.preventDefault();
    e.stopPropagation();
    focusCell(cellAt(info.table, info.row + 1, info.col));
  },
  true
);

// --- the floating toolbar ---
// Icons with English tooltips, the way the rest of the chrome works. It shows up
// over the table the caret is in and disappears the moment the caret leaves.

const ICON_ROW_ABOVE = ['M3 15h18', 'M3 21h18', 'M12 3v8', 'm8.5 6.5 3.5-3.5 3.5 3.5'];
const ICON_ROW_BELOW = ['M3 3h18', 'M3 9h18', 'M12 21v-8', 'm8.5 17.5 3.5 3.5 3.5-3.5'];
const ICON_ROW_DELETE = ['M3 6h18', 'M3 18h18', 'm9 9 6 6', 'm15 9-6 6'];
const ICON_ROW_UP = ['M3 4h18', 'M12 20V9', 'm7 14 5-5 5 5'];
const ICON_ROW_DOWN = ['M3 20h18', 'M12 4v11', 'm7 10 5 5 5-5'];
const ICON_COL_LEFT = ['M15 3v18', 'M21 3v18', 'M3 12h8', 'm6.5 8.5-3.5 3.5 3.5 3.5'];
const ICON_COL_RIGHT = ['M3 3v18', 'M9 3v18', 'M21 12h-8', 'm17.5 8.5 3.5 3.5-3.5 3.5'];
const ICON_COL_DELETE = ['M6 3v18', 'M18 3v18', 'm9 9 6 6', 'm15 9-6 6'];
const ICON_COL_MOVE_LEFT = ['M4 3v18', 'M20 12H9', 'm14 7-5 5 5 5'];
const ICON_COL_MOVE_RIGHT = ['M20 3v18', 'M4 12h11', 'm10 7 5 5-5 5'];
const ICON_ALIGN_LEFT = ['M3 6h18', 'M3 12h10', 'M3 18h14'];
const ICON_ALIGN_CENTER = ['M3 6h18', 'M7 12h10', 'M5 18h14'];
const ICON_ALIGN_RIGHT = ['M3 6h18', 'M11 12h10', 'M7 18h14'];

export const TABLE_COMMANDS = [
  { id: 'rowAbove', label: 'table: add row above', tip: 'Add row above', icon: ICON_ROW_ABOVE },
  { id: 'rowBelow', label: 'table: add row below', tip: 'Add row below', icon: ICON_ROW_BELOW },
  { id: 'rowDelete', label: 'table: delete row', tip: 'Delete row', icon: ICON_ROW_DELETE },
  { id: 'rowUp', label: 'table: move row up', tip: 'Move row up', icon: ICON_ROW_UP },
  { id: 'rowDown', label: 'table: move row down', tip: 'Move row down', icon: ICON_ROW_DOWN },
  { sep: true },
  { id: 'colLeft', label: 'table: add column left', tip: 'Add column left', icon: ICON_COL_LEFT },
  { id: 'colRight', label: 'table: add column right', tip: 'Add column right', icon: ICON_COL_RIGHT },
  { id: 'colDelete', label: 'table: delete column', tip: 'Delete column', icon: ICON_COL_DELETE },
  { id: 'colMoveLeft', label: 'table: move column left', tip: 'Move column left', icon: ICON_COL_MOVE_LEFT },
  { id: 'colMoveRight', label: 'table: move column right', tip: 'Move column right', icon: ICON_COL_MOVE_RIGHT },
  { sep: true },
  { id: 'alignLeft', label: 'table: align column left', tip: 'Align column left', icon: ICON_ALIGN_LEFT },
  { id: 'alignCenter', label: 'table: align column center', tip: 'Align column center', icon: ICON_ALIGN_CENTER },
  { id: 'alignRight', label: 'table: align column right', tip: 'Align column right', icon: ICON_ALIGN_RIGHT }
];

const toolbar = document.createElement('div');
toolbar.id = 'table-toolbar';
toolbar.className = 'hidden';
toolbar.setAttribute('role', 'toolbar');
toolbar.setAttribute('aria-label', 'Table');
for (const cmd of TABLE_COMMANDS) {
  if (cmd.sep) {
    const sep = document.createElement('span');
    sep.className = 'tt-sep';
    toolbar.appendChild(sep);
    continue;
  }
  const btn = document.createElement('button');
  btn.className = 'tt-btn';
  btn.dataset.cmd = cmd.id;
  btn.title = cmd.tip;
  btn.setAttribute('aria-label', cmd.tip);
  btn.appendChild(svgIcon(14, cmd.icon));
  // mousedown, not click: click would land after the caret already left the cell.
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    runTableCommand(cmd.id);
  });
  toolbar.appendChild(btn);
}
document.body.appendChild(toolbar);

const TOOLBAR_GAP = 6;

export function positionToolbar() {
  const info = caretCell();
  if (!info || info.pane !== activePane()) {
    toolbar.classList.add('hidden');
    return;
  }
  toolbar.classList.remove('hidden');
  const t = info.table.getBoundingClientRect();
  const b = toolbar.getBoundingClientRect();
  let top = t.top - b.height - TOOLBAR_GAP;
  if (top < 4) top = t.bottom + TOOLBAR_GAP;
  let left = t.left;
  const max = window.innerWidth - b.width - 6;
  if (left > max) left = Math.max(6, max);
  toolbar.style.top = Math.round(top) + 'px';
  toolbar.style.left = Math.round(Math.max(6, left)) + 'px';
}

export function isTableToolbarOpen() {
  return !toolbar.classList.contains('hidden');
}

// The toolbar follows the caret and nothing else. It reacts to selectionchange
// and to scrolling, never to a wheel guess about where the person is looking.
document.addEventListener('selectionchange', () => positionToolbar());
window.addEventListener('scroll', () => positionToolbar(), true);
window.addEventListener('resize', () => positionToolbar());

for (const cmd of TABLE_COMMANDS) {
  if (cmd.sep) continue;
  registerPaletteAction({ label: cmd.label, run: () => runTableCommand(cmd.id) });
}

// The end to end suite drives the app the way a user would; this is the seam it
// speaks through. app.js owns the general compat surface, so the table feature
// registers its own instead of growing that list.
window.runTableCommand = runTableCommand;
window.caretCell = caretCell;
window.scanTables = scanTables;
window.isTableToolbarOpen = isTableToolbarOpen;
window.getLastGuardTrip = getLastGuardTrip;
