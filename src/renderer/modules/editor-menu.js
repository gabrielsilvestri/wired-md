// The right click menu inside a note. Electron draws no menu of its own, so a
// right click in the text used to do nothing at all: no copy, no paste. This
// one uses the app's own context menu (same look as the tree's) and offers what
// fits where the pointer is: the clipboard, the link under it, the selection
// for the AI CLI, find, and export.
import { panes } from './state.js';
import { showCtxMenu } from './context-menu.js';
import { linkTarget, followLink } from './links.js';
import { openFind } from './find.js';
import { aiCliCommand, sendSelectionToClaude } from './ai-bridge.js';
import { exportNote } from './export-note.js';

const panesEl = document.getElementById('panes');

const run = (cmd) => () => void window.wired.editCommand(cmd);

export function editorMenuItems(pane, target) {
  const sel = window.getSelection();
  const picked = !!sel && !sel.isCollapsed && pane.el.contains(sel.anchorNode) && String(sel).trim() !== '';
  const items = [];
  const link = target && target.closest ? linkTarget(target) : null;
  if (link) {
    items.push({ label: 'open link', run: () => void followLink(pane, link) });
    items.push({ label: 'copy link address', run: () => void navigator.clipboard.writeText(link) });
    items.push({ sep: true });
  }
  if (picked) {
    items.push({ label: 'cut', run: run('cut') });
    items.push({ label: 'copy', run: run('copy') });
  }
  items.push({ label: 'paste', run: run('paste') });
  items.push({ label: 'select all', run: run('selectAll') });
  items.push({ sep: true });
  if (picked) items.push({ label: 'send selection to ' + aiCliCommand(), run: () => sendSelectionToClaude() });
  items.push({ label: 'find in note', run: () => openFind(false) });
  items.push({ sep: true });
  items.push({ label: 'export as PDF', run: () => void exportNote('pdf', null, pane) });
  items.push({ label: 'export as HTML', run: () => void exportNote('html', null, pane) });
  return items;
}

panesEl.addEventListener('contextmenu', (e) => {
  const editor = e.target.closest ? e.target.closest('.vditor-ir') : null;
  if (!editor) return;
  const paneEl = editor.closest('.pane');
  const pane = paneEl ? panes.find((x) => x.el === paneEl) : null;
  if (!pane) return;
  e.preventDefault();
  showCtxMenu(e.clientX, e.clientY, editorMenuItems(pane, e.target));
});
