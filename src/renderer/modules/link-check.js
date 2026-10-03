// Broken links in the status bar. A SKILL.md or a CLAUDE.md that points at a
// note which was renamed or never written fails quietly when an agent follows
// it, so the status bar counts the relative links to Markdown notes that do
// not resolve, and the tooltip names them. Resolution is the same main process
// call Ctrl+click uses (link:resolve), so "broken" here means "Ctrl+click would
// fail". Web links, anchors and images are not checked.
import { activePane } from './state.js';
import { paneText } from './text-cache.js';

const MAX_LINKS = 60;

const span = document.createElement('span');
span.id = 'status-links';
span.className = 'hidden';
const anchor = document.getElementById('status-imports') || document.getElementById('status-tokens');
if (anchor) anchor.after(span);

// The link targets of a Markdown text that point at a local note: inline
// links only, code fences and inline code skipped, images left out.
export function localNoteLinks(text) {
  const prose = String(text || '')
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
  const out = [];
  const re = /(!?)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let m;
  while ((m = re.exec(prose))) {
    if (m[1]) continue; // an image
    const t = m[2];
    if (/^(https?|mailto|ftp|data|javascript):/i.test(t) || t.startsWith('#')) continue;
    if (!/\.(md|markdown)(#.*)?$/i.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX_LINKS);
}

let seq = 0;

export async function updateLinkCheck() {
  const pane = activePane();
  let text = '';
  try {
    text = pane && pane.path && pane.ready && pane.vditor ? paneText(pane) : '';
  } catch {}
  const links = text ? localNoteLinks(text) : [];
  if (!links.length) {
    span.classList.add('hidden');
    span.textContent = '';
    return [];
  }
  const mine = ++seq;
  const results = await Promise.all(links.map((t) => window.wired.resolveLink(pane.path, t)));
  if (mine !== seq) return null; // a newer check already started
  const broken = links.filter((t, i) => !(results[i] && results[i].ok));
  span.classList.toggle('hidden', broken.length === 0);
  span.textContent = broken.length ? broken.length + ' broken link' + (broken.length === 1 ? '' : 's') : '';
  span.title = broken.length
    ? 'These links point at notes that do not exist, so Ctrl+click (or an agent following them) finds nothing:\n\n' + broken.join('\n')
    : '';
  return broken;
}

let timer = 0;
function schedule(delay = 700) {
  clearTimeout(timer);
  timer = setTimeout(() => void updateLinkCheck(), delay);
}

new MutationObserver(() => schedule()).observe(document.getElementById('panes'), {
  subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class']
});
// A note created or renamed on disk can repair a link without the text
// changing: the tree redrawing after the folder watcher is the signal, and so
// is coming back to the window.
const treeEl = document.getElementById('file-tree');
if (treeEl) new MutationObserver(() => schedule()).observe(treeEl, { subtree: true, childList: true });
window.addEventListener('focus', () => schedule(200));
schedule(0);

window.wiredLinkCheck = { updateLinkCheck, localNoteLinks };
