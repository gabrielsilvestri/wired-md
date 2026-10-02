// The outline: the active note's headings in a collapsible sidebar section
// under the tree. A click scrolls the heading into view and puts the caret at
// it; the entry for the heading the caret (or the viewport) is in is marked.
//
// Headings are read from the Markdown source, so a "# comment" inside a fenced
// code block is never one. They are matched to the editor's own heading
// elements by position to jump.
import { config, saveConfig, registerConfigDefaults, activePane } from './state.js';
import { registerPaletteAction } from './palette.js';
import { scrollContainerOf } from './focus-typewriter.js';
import { svgIcon, ICON_CHEVRON } from './icons.js';
import { estimateTokens, formatTokens } from './statusbar.js';

registerConfigDefaults({ outline: true, outlineCollapsed: false });

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// A setext underline: the paragraph right above it is an H1 (===) or H2 (---).
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
// Lines that open something other than a paragraph, so they never become the
// text of a setext heading (a "---" under a list item is a thematic break).
const NOT_PARAGRAPH = /^(?: {4}|\t| {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)| {0,3}>| {0,3}<)/;
const HEADING_TAGS = 'h1,h2,h3,h4,h5,h6';

// Pure: the headings of a Markdown source, skipping the frontmatter and fences.
// Each one carries `chars`, the size of its section (its subsections included,
// up to the next heading of the same or a higher level).
export function parseHeadings(source) {
  const body = source.replace(FRONTMATTER, '');
  const lines = body.split(/\r?\n/);
  const out = [];
  let fence = null;
  let para = []; // the lines of the paragraph being read, for a setext heading
  let paraAt = 0; // where that paragraph starts, in characters
  let at = 0; // where the current line starts, in characters
  // Inline markers add noise to a one line label.
  const label = (raw) => raw.replace(/[*_`~]|!?\[([^\]]*)\]\([^)]*\)/g, '$1').trim() || '(empty heading)';
  for (let li = 0; li < lines.length; at += lines[li].length + 1, li++) {
    const line = lines[li];
    const f = line.match(FENCE);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      continue;
    }
    if (f) { fence = f[1]; para = []; continue; }
    const m = line.match(HEADING);
    if (m) {
      out.push({ level: m[1].length, text: label(m[2] || ''), at });
      para = [];
      continue;
    }
    const u = para.length ? line.match(SETEXT) : null;
    if (u) {
      out.push({ level: u[1][0] === '=' ? 1 : 2, text: label(para.join(' ')), at: paraAt });
      para = [];
      continue;
    }
    if (!line.trim() || (!para.length && NOT_PARAGRAPH.test(line))) para = [];
    else {
      if (!para.length) paraAt = at;
      para.push(line.trim());
    }
  }
  out.forEach((h, i) => {
    const next = out.slice(i + 1).find((x) => x.level <= h.level);
    h.chars = (next ? next.at : body.length) - h.at;
  });
  return out;
}

const section = document.createElement('div');
section.id = 'outline-section';
section.className = 'hidden';
section.innerHTML = `
  <button id="outline-header" type="button" aria-expanded="true" title="Outline (click to collapse)" aria-label="Outline">
    <span class="outline-chevron"></span>
    <span>outline</span>
  </button>
  <ul id="outline-list" role="list"></ul>`;
const header = section.querySelector('#outline-header');
const list = section.querySelector('#outline-list');
header.querySelector('.outline-chevron').append(svgIcon(12, ICON_CHEVRON));
document.getElementById('sidebar').insertBefore(section, document.getElementById('recent-section'));

let headings = [];
let items = [];
let followCaret = false;

function rootOf(pane) {
  return pane && pane.el ? pane.el.querySelector('.vditor-ir .vditor-reset') : null;
}

function editorHeadings(pane) {
  const root = rootOf(pane);
  return root ? Array.from(root.querySelectorAll(':scope > ' + HEADING_TAGS.split(',').join(', :scope > '))) : [];
}

function applyVisibility() {
  const pane = activePane();
  section.classList.toggle('hidden', config.outline === false || !pane);
  const collapsed = !!config.outlineCollapsed;
  section.classList.toggle('collapsed', collapsed);
  header.setAttribute('aria-expanded', String(!collapsed));
  header.title = collapsed ? 'Outline (click to expand)' : 'Outline (click to collapse)';
}

export function renderOutline() {
  applyVisibility();
  const pane = activePane();
  list.textContent = '';
  items = [];
  headings = [];
  if (config.outline === false || !pane) return;
  let source = '';
  try {
    source = pane.ready && pane.vditor ? pane.vditor.getValue() : '';
  } catch {
    source = '';
  }
  headings = parseHeadings(source);
  if (!headings.length) {
    const li = document.createElement('li');
    li.className = 'outline-empty';
    li.textContent = 'no headings';
    list.append(li);
    return;
  }
  const base = Math.min(...headings.map((h) => h.level));
  headings.forEach((h, i) => {
    const li = document.createElement('li');
    li.className = 'outline-item';
    li.dataset.level = h.level;
    li.style.paddingLeft = 12 + (h.level - base) * 12 + 'px';
    li.textContent = h.text;
    li.title = 'H' + h.level + ': ' + h.text + '\n' + formatTokens(estimateTokens(h.chars)) + ' in this section';
    li.addEventListener('click', () => jumpTo(i));
    list.append(li);
    items.push(li);
  });
  markCurrent();
}

// The editor heading element for outline entry i. Source and editor agree by
// position; when they do not (a setext heading the parser skipped), fall back
// to the first editor heading with the same level and text.
function elementFor(pane, i) {
  const els = editorHeadings(pane);
  const h = headings[i];
  const same = (e) => e.tagName === 'H' + h.level;
  if (els.length === headings.length && els[i] && same(els[i])) return els[i];
  return els.find((e) => same(e) && e.textContent.replace(/^#+\s*/, '').includes(h.text.slice(0, 20))) || null;
}

function jumpTo(i) {
  const pane = activePane();
  const target = pane && elementFor(pane, i);
  const root = rootOf(pane);
  if (!target || !root) return;
  const cont = scrollContainerOf(target, pane);
  if (cont) cont.scrollTop += target.getBoundingClientRect().top - cont.getBoundingClientRect().top - 16;
  root.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  followCaret = true;
  markCurrent();
}

// The heading the caret is under, or, when the caret is elsewhere or the user
// scrolled by hand, the last heading that has passed the top of the viewport.
function currentIndex(pane) {
  const els = editorHeadings(pane);
  if (!els.length || els.length !== headings.length) return -1;
  const root = rootOf(pane);
  const sel = window.getSelection();
  if (followCaret && sel && sel.anchorNode && root && root.contains(sel.anchorNode)) {
    let idx = -1;
    els.forEach((e, i) => {
      if (e === sel.anchorNode || e.contains(sel.anchorNode) ||
          (e.compareDocumentPosition(sel.anchorNode) & Node.DOCUMENT_POSITION_FOLLOWING)) idx = i;
    });
    return idx;
  }
  const cont = scrollContainerOf(els[0], pane) || root;
  const top = cont.getBoundingClientRect().top + 24;
  let idx = -1;
  els.forEach((e, i) => { if (e.getBoundingClientRect().top <= top) idx = i; });
  return idx;
}

function markCurrent() {
  const pane = activePane();
  const idx = pane ? currentIndex(pane) : -1;
  items.forEach((li, i) => {
    li.classList.toggle('current', i === idx);
    if (i === idx) li.setAttribute('aria-current', 'location'); else li.removeAttribute('aria-current');
  });
  const cur = items[idx];
  if (cur && !section.classList.contains('collapsed')) cur.scrollIntoView({ block: 'nearest' });
}

export function toggleOutline(forceOn) {
  config.outline = forceOn === undefined ? config.outline === false : !!forceOn;
  saveConfig();
  renderOutline();
}

let timer = 0;
function schedule(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(renderOutline, delay);
}

header.addEventListener('click', () => {
  config.outlineCollapsed = !config.outlineCollapsed;
  saveConfig();
  applyVisibility();
});

// Typing, setValue and a tab switch all change the editor DOM or the active
// class; no hook in the pane code is needed.
new MutationObserver(() => schedule()).observe(document.getElementById('panes'), {
  subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class']
});
let markFrame = 0;
const markSoon = () => {
  if (markFrame) return;
  markFrame = requestAnimationFrame(() => { markFrame = 0; markCurrent(); });
};
document.addEventListener('selectionchange', () => {
  const pane = activePane();
  const sel = window.getSelection();
  const root = rootOf(pane);
  followCaret = !!(root && sel && sel.anchorNode && root.contains(sel.anchorNode));
  markSoon();
});
// Scroll does not bubble, so the capture phase on the document hears every pane.
// A hand scroll hands the marker back to the viewport.
document.addEventListener('scroll', (e) => {
  if (e.target.nodeType === 1 && e.target.closest && e.target.closest('#panes')) {
    followCaret = false;
    markSoon();
  }
}, true);

registerPaletteAction({
  label: () => (config.outline === false ? 'outline: show' : 'outline: hide'),
  hint: 'headings of the note',
  run: () => toggleOutline()
});
schedule(0);
