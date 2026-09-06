// Find the note's text without inserting markup into Vditor's editable DOM.
// IR previews duplicate code; search the editable source once and reveal it
// when navigating there. Markdown markers are not document text.
import { activePane } from './state.js';
import { setPaneDirty, updateEmptyState } from './panes.js';
import { refreshFmPanel } from './frontmatter.js';
import { applyFocusMode, scrollContainerOf } from './focus-typewriter.js';
import { registerPaletteAction } from './palette.js';
import { svgIcon, ICON_X, ICON_CHEVRON } from './icons.js';

const bar = document.createElement('section');
bar.id = 'note-find';
bar.className = 'note-find hidden';
bar.setAttribute('aria-label', 'Find in note');
bar.innerHTML = `
  <div class="note-find-row">
    <button id="note-find-expand" class="tb-btn" title="Show replacement (Ctrl+H)" aria-label="Show replacement" aria-expanded="false"></button>
    <label class="note-find-field"><span>Find</span><input id="note-find-query" type="text" spellcheck="false" autocomplete="off"></label>
    <button id="note-find-case" class="tb-btn" title="Match case" aria-label="Match case" aria-pressed="false">Aa</button>
    <button id="note-find-word" class="tb-btn" title="Whole word" aria-label="Whole word" aria-pressed="false">ab</button>
    <span id="note-find-count" role="status" aria-live="polite" aria-atomic="true"></span>
    <button id="note-find-prev" class="tb-btn" title="Previous match (Shift+Enter)" aria-label="Previous match"></button>
    <button id="note-find-next" class="tb-btn" title="Next match (Enter)" aria-label="Next match"></button>
    <button id="note-find-close" class="tb-btn" title="Close find (Escape)" aria-label="Close find"></button>
  </div>
  <div id="note-find-replace-row" class="note-find-row hidden">
    <label class="note-find-field"><span>Replace</span><input id="note-find-replacement" type="text" spellcheck="false" autocomplete="off"></label>
    <button id="note-find-replace" class="tb-btn" title="Replace match" aria-label="Replace match"></button>
    <button id="note-find-all" class="tb-btn" title="Replace all matches" aria-label="Replace all matches"></button>
  </div>`;
const el = (id) => bar.querySelector('#note-find-' + id);
const query = el('query');
const replacement = el('replacement');
el('expand').append(svgIcon(14, ICON_CHEVRON));
el('prev').append(svgIcon(14, ['m18 15-6-6-6 6']));
el('next').append(svgIcon(14, ['m6 9 6 6 6-6']));
el('close').append(svgIcon(14, ICON_X));
el('replace').append(svgIcon(15, ['M3 5h12v6', 'm11 8 4 4 4-4', 'M3 19h8']));
el('all').append(svgIcon(15, ['M3 5h12v6', 'm11 8 4 4 4-4', 'M3 16h8', 'M3 20h8', 'M16 17h5', 'M18.5 14.5v5']));

let pane = null;
let matches = [];
let current = -1;
let frame = 0;
let expandedNode = null;
let matchCase = false;
let wholeWord = false;

const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote';
const SKIP = '.vditor-ir__preview,.vditor-ir__marker:not(.vditor-ir__marker--pre),[data-type="code-block-open-marker"],[data-type="code-block-close-marker"],[data-type="link-dest"],script,style,wbr';

// Each UTF-16 offset maps back to its text node. Inline formatting stays in
// the stream; block boundaries stop a phrase matching across unrelated cells.
function textIndex(root) {
  const nodes = [];
  let text = '';
  let lastBlock = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data || node.parentElement.closest(SKIP)) continue;
    const block = node.parentElement.closest(BLOCK);
    if (nodes.length && block !== lastBlock) text += '\n';
    nodes.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
    lastBlock = block;
  }
  return { text, nodes };
}

function search(root) {
  if (!query.value || !root) return [];
  const { text, nodes } = textIndex(root);
  const literal = query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(literal, matchCase ? 'gu' : 'giu');
  const result = [];
  let cursor = 0;
  for (const hit of text.matchAll(pattern)) {
    const start = hit.index;
    const end = start + hit[0].length;
    // Unicode letters, marks and numbers belong to a word, as does underscore.
    if (wholeWord && (/[\p{L}\p{M}\p{N}_]$/u.test(text.slice(Math.max(0, start - 2), start)) || /^[\p{L}\p{M}\p{N}_]/u.test(text.slice(end, end + 2)))) continue;
    while (cursor < nodes.length && nodes[cursor].end <= start) cursor++;
    const parts = [];
    for (let i = cursor; i < nodes.length && nodes[i].start < end; i++) {
      const item = nodes[i];
      parts.push({ node: item.node, start: Math.max(0, start - item.start), end: Math.min(item.node.length, end - item.start) });
    }
    if (!parts.length) continue;
    const range = document.createRange();
    range.setStart(parts[0].node, parts[0].start);
    range.setEnd(parts.at(-1).node, parts.at(-1).end);
    result.push({ start, end, parts, range });
  }
  return result;
}

function editor() {
  return pane?.ready ? pane.el.querySelector('.vditor-ir .vditor-reset') : null;
}

function collapseRevealed() {
  if (expandedNode && !expandedNode.contains(window.getSelection()?.anchorNode)) {
    expandedNode.classList.remove('vditor-ir__node--expand');
  }
  expandedNode = null;
}

function paint(scroll = false) {
  CSS.highlights.delete('note-find-current');
  const highlights = new Highlight();
  for (const hit of matches) highlights.add(hit.range);
  CSS.highlights.set('note-find-matches', highlights);
  if (current >= 0 && matches[current]) {
    const hit = matches[current];
    CSS.highlights.set('note-find-current', new Highlight(hit.range));
    if (scroll) {
      collapseRevealed();
      const node = hit.parts[0].node.parentElement;
      const irNode = node.closest('.vditor-ir__node');
      if (irNode && !irNode.classList.contains('vditor-ir__node--expand')) {
        expandedNode = irNode;
        irNode.classList.add('vditor-ir__node--expand');
      }
      // Scroll the editor only, without changing focus or the selection.
      const scroller = scrollContainerOf(node, pane) || editor();
      const rect = hit.range.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      if (rect.top < view.top || rect.bottom > view.bottom) scroller.scrollTop += rect.top - view.top - view.height / 2;
    }
  }
  el('count').textContent = !pane ? 'No open note' : !query.value ? 'Type to find' : matches.length ? `${current + 1} of ${matches.length}` : 'No matches';
  for (const name of ['prev', 'next', 'replace', 'all']) el(name).disabled = matches.length === 0;
}

function refresh(reset = false, scroll = false) {
  if (bar.classList.contains('hidden')) return;
  const next = activePane();
  if (next !== pane) {
    collapseRevealed();
    pane = next;
    reset = true;
  }
  const host = pane?.el || document.getElementById('editor-area');
  if (bar.parentElement !== host) host.prepend(bar);
  matches = search(editor());
  current = matches.length ? reset ? 0 : Math.max(0, Math.min(current, matches.length - 1)) : -1;
  paint(scroll);
}

const observer = new MutationObserver((records) => {
  if (records.every((record) => bar.contains(record.target))) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => refresh());
});

export function openFind(replace = false) {
  const selected = window.getSelection();
  const active = activePane();
  const text = selected && active?.el.contains(selected.anchorNode) ? selected.toString() : '';
  if (text && !/[\r\n]/.test(text)) query.value = text;
  bar.classList.remove('hidden');
  observer.observe(document.getElementById('panes'), { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  if (replace) toggleReplacement(true);
  refresh(true, true);
  query.focus();
  query.select();
}

export function closeFind() {
  observer.disconnect();
  cancelAnimationFrame(frame);
  collapseRevealed();
  bar.classList.add('hidden');
  CSS.highlights.delete('note-find-matches');
  CSS.highlights.delete('note-find-current');
  if (pane?.el.isConnected && pane.ready) pane.vditor.focus();
}

function toggleReplacement(show = el('replace-row').classList.contains('hidden')) {
  el('replace-row').classList.toggle('hidden', !show);
  el('expand').setAttribute('aria-expanded', String(show));
}

function navigate(delta) {
  refresh();
  if (!matches.length) return;
  current = (current + delta + matches.length) % matches.length;
  paint(true);
}

function replaceMatches(all) {
  // Refresh synchronously: typing, tab switches and undo can precede the next frame.
  refresh();
  const root = editor();
  if (!root || !matches.length) return;
  const clone = root.cloneNode(true);
  const found = search(clone);
  const chosen = all ? found : [found[current]];
  const nextOffset = found[current].start + replacement.value.length;
  for (const hit of chosen.slice().reverse()) {
    for (let i = hit.parts.length - 1; i >= 0; i--) {
      const { node, start, end } = hit.parts[i];
      node.replaceData(start, end - start, i === 0 ? replacement.value : '');
    }
  }
  const vd = pane.vditor;
  const next = vd.vditor.lute.VditorIRDOM2Md(clone.innerHTML);
  if (next !== vd.getValue()) {
    // Flush pending typing and commit each replacement as a single undo step.
    const internal = vd.vditor;
    if (internal.lute.VditorIRDOM2Md(internal.undo.ir.lastText) !== vd.getValue()) {
      internal.undo.addToUndoStack(internal);
    }
    vd.setValue(next);
    // setValue normally debounces this. Commit now so rapid replacements stay
    // separate and later preview/caret changes cannot add an empty undo step.
    clearTimeout(internal.ir.processTimeoutId);
    internal.undo.addToUndoStack(internal);
    setPaneDirty(pane, true);
    refreshFmPanel(pane);
    updateEmptyState();
    applyFocusMode();
  }
  refresh();
  if (!all && matches.length) {
    const index = matches.findIndex((hit) => hit.start >= nextOffset);
    current = index < 0 ? 0 : index;
  }
  paint(true);
}

query.addEventListener('input', () => refresh(true, true));
el('case').addEventListener('click', () => {
  matchCase = !matchCase;
  el('case').setAttribute('aria-pressed', String(matchCase));
  refresh(true, true);
});
el('word').addEventListener('click', () => {
  wholeWord = !wholeWord;
  el('word').setAttribute('aria-pressed', String(wholeWord));
  refresh(true, true);
});
el('expand').addEventListener('click', () => toggleReplacement());
el('prev').addEventListener('click', () => navigate(-1));
el('next').addEventListener('click', () => navigate(1));
el('close').addEventListener('click', closeFind);
el('replace').addEventListener('click', () => replaceMatches(false));
el('all').addEventListener('click', () => replaceMatches(true));

export function handleFindKey(e) {
  if (e.isComposing || e.altKey) return false;
  if (e.ctrlKey && !e.shiftKey && ['f', 'h'].includes(e.key.toLowerCase())) {
    openFind(e.key.toLowerCase() === 'h');
  } else if (!bar.classList.contains('hidden') && (bar.contains(e.target) || pane?.el.contains(e.target))) {
    if (e.key === 'Escape') closeFind();
    else if (e.key === 'F3' || (e.key === 'Enter' && (e.target === query || e.target === replacement))) {
      if (e.target === replacement && !e.shiftKey && !e.ctrlKey) replaceMatches(false);
      else navigate(e.shiftKey ? -1 : 1);
    } else return false;
  } else return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}

registerPaletteAction({ label: 'find in note', hint: 'Ctrl+F', run: () => openFind() });
registerPaletteAction({ label: 'replace in note', hint: 'Ctrl+H', run: () => openFind(true) });
