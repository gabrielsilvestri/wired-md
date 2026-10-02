// A slim status bar under the editor area: words, characters and a token
// estimate for the active note, plus the selection when there is one. It sits in
// the main column (above the terminal), so it never covers text.
//
// Counts come from the Markdown source. The YAML frontmatter is left out of the
// word count but stays in characters and tokens, since both reach the model's
// context window.
import { config, saveConfig, registerConfigDefaults, activePane } from './state.js';
import { registerPaletteAction } from './palette.js';

registerConfigDefaults({ statusBar: true });

const CHARS_PER_TOKEN = 4;
const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

const bar = document.createElement('div');
bar.id = 'status-bar';
bar.className = 'status-bar hidden';
bar.setAttribute('role', 'status');
bar.setAttribute('aria-label', 'Document statistics');
bar.innerHTML = `
  <span id="status-words"></span>
  <span id="status-chars"></span>
  <span id="status-tokens" title="Rough estimate: characters divided by about 4. Not a tokenizer, so real counts differ by model. The frontmatter counts here because it is sent to the model too."></span>
  <span id="status-selection"></span>`;
const el = (id) => bar.querySelector('#status-' + id);

export function countWords(text) {
  let n = 0;
  for (const w of text.match(/\S+/g) || []) if (/[\p{L}\p{N}]/u.test(w)) n++;
  return n;
}

export function estimateTokens(chars) {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function formatTokens(n) {
  if (n < 1000) return '~' + n + ' tokens';
  const k = Math.round(n / 100) / 10;
  return '~' + (k >= 100 ? Math.round(k) : k) + 'k tokens';
}

const plural = (n, word) => n.toLocaleString('en-US') + ' ' + word + (n === 1 ? '' : 's');

function selectionIn(pane) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode || !pane || !pane.el.contains(sel.anchorNode)) return '';
  return sel.toString();
}

export function updateStatusBar() {
  const pane = activePane();
  const on = config.statusBar !== false && !!pane;
  bar.classList.toggle('hidden', !on);
  if (!on) return;
  let source = '';
  try {
    source = pane.ready && pane.vditor ? pane.vditor.getValue() : '';
  } catch {
    source = '';
  }
  const body = source.replace(FRONTMATTER, '');
  el('words').textContent = plural(countWords(body), 'word');
  el('chars').textContent = plural(source.length, 'character');
  el('tokens').textContent = formatTokens(estimateTokens(source.length));
  const picked = selectionIn(pane);
  const s = el('selection');
  s.textContent = picked ? plural(countWords(picked), 'word') + ', ' + formatTokens(estimateTokens(picked.length)) + ' selected' : '';
  s.classList.toggle('hidden', !picked);
}

export function toggleStatusBar(forceOn) {
  config.statusBar = forceOn === undefined ? config.statusBar === false : !!forceOn;
  saveConfig();
  updateStatusBar();
}

let timer = 0;
function schedule(delay = 200) {
  clearTimeout(timer);
  timer = setTimeout(updateStatusBar, delay);
}

// The editor DOM changing covers typing, setValue and a tab switch (the active
// class moves), without a hook in the pane code.
document.getElementById('main-col').insertBefore(bar, document.getElementById('terminal-panel'));
new MutationObserver(() => schedule()).observe(document.getElementById('panes'), {
  subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class']
});
document.addEventListener('selectionchange', () => schedule(80));

registerPaletteAction({
  label: () => (config.statusBar === false ? 'status bar: show' : 'status bar: hide'),
  hint: 'words and token estimate',
  run: () => toggleStatusBar()
});
schedule(0);
