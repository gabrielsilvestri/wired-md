// Command palette (Ctrl+Shift+P) and quick switcher (Ctrl+P).
//
// The action list is a REGISTRY: registerPaletteAction appends to it, so a new
// feature adds its command from its own module instead of editing this array
// (and two features added in parallel never collide on the same line).
//
// An action's `label` may be a function, so a toggle can show what Enter will do
// right now ("focus mode: turn on" becomes "turn off" once it is on).

import { config } from './state.js';
import { toggleSidebar, getTreeFiles } from './tree.js';
import { openPath, newFile, openViaDialog, save, saveAs, closeActivePane } from './panes.js';
import { newFromTemplate } from './templates.js';
import { openSearch } from './search.js';
import { toggleFrontmatterPanel } from './frontmatter.js';
import { toggleFocusMode, toggleTypewriterMode } from './focus-typewriter.js';
import { toggleTerminal, cdTerminalToNote } from './terminal.js';
import { sendFileToClaude, sendSelectionToClaude, setLastSelection } from './ai-bridge.js';
import { openSettings } from './settings.js';

const paletteOverlay = document.getElementById('palette-overlay');
const paletteInput = document.getElementById('palette-input');
const paletteList = document.getElementById('palette-list');

let paletteMode = null; // 'commands' | 'files'
let paletteItems = []; // filtered items on screen: { label, hint, run(ctrl) }
let paletteSel = 0;

export const PALETTE_ACTIONS = [];

// The registry other modules use. `at` may be an index to insert at; by default
// the action goes to the end.
export function registerPaletteAction(action, at) {
  if (typeof at === 'number') PALETTE_ACTIONS.splice(at, 0, action);
  else PALETTE_ACTIONS.push(action);
  return action;
}

registerPaletteAction({ label: 'toggle sidebar', run: () => toggleSidebar() });
registerPaletteAction({ label: 'new file', hint: 'Ctrl+N', run: () => newFile() });
registerPaletteAction({ label: 'new from template', run: () => newFromTemplate() });
registerPaletteAction({ label: 'open file', hint: 'Ctrl+O', run: () => openViaDialog(false) });
registerPaletteAction({ label: 'open file beside', run: () => openViaDialog(true) });
registerPaletteAction({ label: 'save', hint: 'Ctrl+S', run: () => save() });
registerPaletteAction({ label: 'save as', hint: 'Ctrl+Shift+S', run: () => saveAs() });
registerPaletteAction({ label: 'search in folder', hint: 'Ctrl+Shift+F', run: () => openSearch() });
registerPaletteAction({ label: 'properties: show or hide', run: () => toggleFrontmatterPanel() });
registerPaletteAction({ label: () => 'focus mode: ' + (config.focusMode ? 'turn off' : 'turn on'), hint: 'F8', run: () => toggleFocusMode() });
registerPaletteAction({ label: () => 'typewriter mode: ' + (config.typewriterMode ? 'turn off' : 'turn on'), hint: 'F9', run: () => toggleTypewriterMode() });
registerPaletteAction({ label: 'close tab', hint: 'Ctrl+W', run: () => closeActivePane() });
registerPaletteAction({ label: 'toggle terminal', hint: 'Ctrl+`', run: () => toggleTerminal() });
registerPaletteAction({
  label: 'terminal: cd to the note folder',
  run: () => {
    toggleTerminal(true);
    setTimeout(cdTerminalToNote, 300);
  }
});
registerPaletteAction({ label: 'send file to claude', run: () => sendFileToClaude() });
registerPaletteAction({ label: 'send selection to claude', run: () => sendSelectionToClaude() });
registerPaletteAction({ label: 'settings', run: () => openSettings() });

// Fuzzy by subsequence: every character of the query has to appear in order.
// Scores word starts and contiguous runs; the shortest distance wins.
export function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return -Infinity;
    if (idx === ti && qi > 0) {
      streak += 1;
      score += 3 + streak;
    } else {
      streak = 0;
      score += 1;
      if (idx === 0 || /[\s\-_./\\]/.test(t[idx - 1])) score += 3;
      score -= Math.min(idx - ti, 10) * 0.1;
    }
    ti = idx + 1;
  }
  score -= t.length * 0.01;
  return score;
}

export function openPalette(mode) {
  paletteMode = mode;
  // The selection is captured when the palette opens, because focusing the input
  // drops the editor selection.
  setLastSelection(window.getSelection ? String(window.getSelection()).trim() : '');
  paletteInput.value = '';
  paletteInput.placeholder = mode === 'files' ? 'find a file... (Enter opens, Ctrl+Enter opens beside)' : 'find a command...';
  paletteOverlay.classList.remove('hidden');
  renderPalette();
  paletteInput.focus();
}

export function closePalette() {
  paletteOverlay.classList.add('hidden');
  paletteMode = null;
}

export function isPaletteOpen() {
  return !paletteOverlay.classList.contains('hidden');
}

function paletteSource() {
  if (paletteMode === 'files') {
    return getTreeFiles().map((f) => ({
      label: f.name,
      hint: f.path,
      run: (ctrl) => openPath(f.path, !!ctrl)
    }));
  }
  return PALETTE_ACTIONS.map((a) => ({ label: typeof a.label === 'function' ? a.label() : a.label, hint: a.hint || '', run: () => a.run() }));
}

function renderPalette() {
  const q = paletteInput.value.trim();
  const scored = [];
  for (const item of paletteSource()) {
    const s = fuzzyScore(q, item.label);
    if (s === -Infinity) continue;
    scored.push({ item, s });
  }
  scored.sort((a, b) => b.s - a.s);
  paletteItems = scored.slice(0, 30).map((x) => x.item);
  paletteSel = 0;
  paletteList.innerHTML = '';
  if (paletteItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = 'nothing found';
    paletteList.appendChild(empty);
    return;
  }
  paletteItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'palette-row' + (i === paletteSel ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'palette-label';
    label.textContent = item.label;
    row.appendChild(label);
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'palette-hint';
      hint.textContent = item.hint;
      row.appendChild(hint);
    }
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      runPaletteItem(item, e.ctrlKey);
    });
    paletteList.appendChild(row);
  });
}

function movePaletteSel(delta) {
  if (paletteItems.length === 0) return;
  paletteSel = (paletteSel + delta + paletteItems.length) % paletteItems.length;
  const rows = paletteList.querySelectorAll('.palette-row');
  rows.forEach((r, i) => r.classList.toggle('selected', i === paletteSel));
  const sel = rows[paletteSel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(item, ctrl) {
  closePalette();
  item.run(ctrl);
}

paletteInput.addEventListener('input', renderPalette);

paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    movePaletteSel(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    movePaletteSel(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = paletteItems[paletteSel];
    if (item) runPaletteItem(item, e.ctrlKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  }
});

paletteOverlay.addEventListener('mousedown', (e) => {
  if (e.target === paletteOverlay) closePalette();
});
