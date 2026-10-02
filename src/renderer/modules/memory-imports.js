// CLAUDE.md imports in the editor. Claude Code loads every `@path` a memory file
// imports (four hops deep), and the docs are explicit that imports organize a
// file without lowering its context cost. So for CLAUDE.md, CLAUDE.local.md and
// AGENTS.md the status bar adds what the imports bring in, flags a broken one,
// and Ctrl+click on an `@path` opens it. Resolution lives in the main process
// (src/main/ipc/imports.js); this module only asks and draws.
import { activePane, panes } from './state.js';
import { openPath } from './panes.js';
import { paneStatus } from './links.js';
import { estimateTokens, formatTokens } from './statusbar.js';
import { paneText } from './text-cache.js';

const MEMORY_FILES = /^(claude|claude\.local|agents)\.md$/i;

const panesEl = document.getElementById('panes');
const span = document.createElement('span');
span.id = 'status-imports';
span.className = 'hidden';
const tokensEl = document.getElementById('status-tokens');
if (tokensEl) tokensEl.after(span);

export function isMemoryFile(p) {
  return !!p && MEMORY_FILES.test(p.split(/[\\/]/).pop());
}

let seq = 0;

export async function updateImports() {
  const pane = activePane();
  const p = pane && pane.path;
  let source = '';
  // Only a memory file is worth reading at all.
  try {
    source = isMemoryFile(p) && pane.ready && pane.vditor ? paneText(pane) : '';
  } catch {}
  if (!isMemoryFile(p) || source.indexOf('@') === -1) {
    span.classList.add('hidden');
    span.textContent = '';
    return;
  }
  const mine = ++seq;
  const res = await window.wired.scanImports(p, source);
  if (mine !== seq) return; // a newer scan already started
  const items = (res && res.items) || [];
  if (!items.length) {
    span.classList.add('hidden');
    span.textContent = '';
    return;
  }
  const missing = items.filter((it) => !it.exists);
  const n = items.length;
  span.textContent =
    'imports ' + formatTokens(estimateTokens(res.chars)) + ', ' + n + ' file' + (n === 1 ? '' : 's') +
    (missing.length ? ', ' + missing.length + ' missing' : '');
  span.classList.toggle('imports-missing', missing.length > 0);
  span.classList.remove('hidden');
  span.title =
    'Claude Code loads these with the note, so they cost context too. Ctrl+click an @path in the text to open it.\n\n' +
    items.map((it) => '  '.repeat(it.depth - 1) + it.path + (it.exists ? '  (' + formatTokens(estimateTokens(it.chars)) + ')' : '  (missing)')).join('\n') +
    (res.truncated ? '\n(stopped after ' + n + ' files)' : '');
}

let timer = 0;
function schedule(delay = 500) {
  clearTimeout(timer);
  timer = setTimeout(() => void updateImports(), delay);
}

new MutationObserver(() => schedule()).observe(panesEl, {
  subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class']
});

// --- Ctrl+click on an @path ---

// The whitespace delimited word under the pointer, keeping "\ " escaped spaces
// inside it the way the import syntax writes them.
function wordAt(x, y) {
  const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
  if (!r || !r.startContainer || r.startContainer.nodeType !== Node.TEXT_NODE) return '';
  const text = r.startContainer.nodeValue || '';
  const at = r.startOffset;
  const isBreak = (i) => /\s/.test(text[i]) && text[i - 1] !== '\\';
  let a = at;
  while (a > 0 && !isBreak(a - 1)) a--;
  let b = at;
  while (b < text.length && !isBreak(b)) b++;
  return text.slice(a, b);
}

export async function openImport(pane, word) {
  const m = /^\(?@(.+)$/.exec(word || '');
  if (!m || !pane) return false;
  const res = await window.wired.resolveImport(pane.path || '', m[1].replace(/\)+$/, ''));
  if (!res || !res.ok) paneStatus(pane, 'Cannot open the import: ' + ((res && res.error) || 'unknown error'));
  else if (!res.exists) paneStatus(pane, 'Import not found: ' + res.path);
  else if (!res.markdown) paneStatus(pane, 'Only Markdown opens in the app: ' + res.path);
  else await openPath(res.path);
  return true;
}

panesEl.addEventListener(
  'click',
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || e.defaultPrevented) return;
    const paneEl = e.target.closest ? e.target.closest('.pane') : null;
    const pane = paneEl ? panes.find((x) => x.el === paneEl) : null;
    if (!pane || !isMemoryFile(pane.path)) return;
    const word = wordAt(e.clientX, e.clientY);
    if (!/^\(?@/.test(word)) return;
    e.preventDefault();
    e.stopPropagation();
    void openImport(pane, word);
  },
  true
);

schedule(0);

// The E2E drives these directly (a real OS drag or click position is not always
// reachable from the suite).
window.wiredImports = { updateImports, openImport, isMemoryFile };
