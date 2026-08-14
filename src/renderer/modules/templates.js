// New file from a template, with variables.
//
// Templates are .md files in %APPDATA%\wired-md\templates (seeded from the
// repo's templates\ on first boot). The folder is re-read every time the picker
// opens, so a template dropped in there while the app runs shows up with no
// restart and no watcher.
//
// Variables: {{date}}, {{time}}, {{title}}, {{folder}}, {{cursor}} (where the
// caret lands; the marker never reaches disk) and {{ask:label}} (asked once per
// label in the app's own dialog). An unknown {{marker}} is left intact, never an
// error.

import { activePane, baseName } from './state.js';
import { askInput } from './dialogs.js';
import { openPath, newFile, setPaneDirty } from './panes.js';
import { getSelectedDir, getTreeRoot } from './tree.js';
import { refreshFmPanel } from './frontmatter.js';

const templateOverlay = document.getElementById('template-overlay');
const templateListEl = document.getElementById('template-list');

let templateItems = []; // [{ file, name }] currently on screen
let templateSel = 0;
let templateResolve = null;

export function getTemplateSel() {
  return templateSel;
}

export function setTemplateSel(v) {
  templateSel = v;
}

// Name suggestion for the templates with a fixed convention; the rest falls back.
const TEMPLATE_SUGGESTION = { 'skill.md': 'SKILL.md', 'claude-md.md': 'CLAUDE.md' };

// Caret marker. The file on disk never sees this: it is written already without
// the {{cursor}}. The token only lives inside the editor for an instant, to find
// the spot in the rendered DOM, and leaves the text as soon as the caret is set.
const CURSOR_TOKEN = String.fromCharCode(0xe000); // invisible private use character

const RE_VAR = /\{\{\s*([^{}]+?)\s*\}\}/g;

function today() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}

function timeNow() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return two(d.getHours()) + ':' + two(d.getMinutes());
}

// Labels of {{ask:...}} in order of appearance, without repeats: the same label
// is asked once and substituted in every occurrence.
function templateQuestions(text) {
  const labels = [];
  const re = new RegExp(RE_VAR.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    const key = m[1].trim();
    if (!/^ask\s*:/i.test(key)) continue;
    const label = key.slice(key.indexOf(':') + 1).trim();
    if (label && labels.indexOf(label) === -1) labels.push(label);
  }
  return labels;
}

// Index where the closing --- of the frontmatter starts, or 0 when the text does
// not open with a YAML block. It tells whether a marker falls INSIDE the
// frontmatter (where the value has to be valid YAML) or in the body (free text).
function frontmatterEnd(text) {
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) return 0;
  const close = /\r?\n---[ \t]*(\r?\n|$)/.exec(text.slice(open[0].length));
  if (!close) return 0;
  return open[0].length + close.index;
}

// Does the marker occupy the WHOLE value of a YAML key (`key: {{...}}`, nothing
// else on the line)? Only then can it be replaced by a quoted scalar without
// breaking the formatting around it.
function isWholeYamlValue(text, offset, len) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  let lineEnd = text.indexOf('\n', offset);
  if (lineEnd === -1) lineEnd = text.length;
  const before = text.slice(lineStart, offset);
  const after = text.slice(offset + len, lineEnd);
  return /^[ \t]*[^:#\s][^:]*:[ \t]+$/.test(before) && /^[ \t]*$/.test(after);
}

// Wraps the answer in a double quoted YAML scalar with escapes. Double quotes
// allow any content (single quotes, colons, #), as long as the backslash, the
// double quote itself and the control characters are escaped.
function yamlQuotedScalar(s) {
  const esc = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return '"' + esc + '"';
}

export function applyVariables(text, ctx) {
  const fmEnd = frontmatterEnd(text);
  return text.replace(new RegExp(RE_VAR.source, 'g'), (whole, rawKey, offset) => {
    const key = rawKey.trim();
    const low = key.toLowerCase();
    let value;
    if (low === 'date') value = ctx.date;
    else if (low === 'time') value = ctx.time;
    else if (low === 'title') value = ctx.title;
    else if (low === 'folder') value = ctx.folder;
    else if (low === 'cursor') return ctx.cursor; // invisible caret token, never YAML
    else if (/^ask\s*:/i.test(key)) {
      const label = key.slice(key.indexOf(':') + 1).trim();
      if (!Object.prototype.hasOwnProperty.call(ctx.answers, label)) return whole;
      value = ctx.answers[label];
    } else {
      return whole;
    }
    // Inside the frontmatter, a whole key value becomes a quoted scalar: without
    // that, an answer with a quote, a colon or a # breaks the YAML and the file
    // that was just created opens complaining about invalid YAML.
    if (offset < fmEnd && isWholeYamlValue(text, offset, whole.length)) {
      return yamlQuotedScalar(value);
    }
    return value;
  });
}

function markTemplateSel() {
  const rows = templateListEl.querySelectorAll('.palette-row');
  rows.forEach((r, i) => r.classList.toggle('selected', i === templateSel));
  const sel = rows[templateSel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function moveTemplateSel(delta) {
  if (templateItems.length === 0) return;
  templateSel = (templateSel + delta + templateItems.length) % templateItems.length;
  markTemplateSel();
}

export function closeTemplatePicker(item) {
  if (templateOverlay.classList.contains('hidden')) return;
  templateOverlay.classList.add('hidden');
  window.removeEventListener('keydown', templateKeydown, true);
  const r = templateResolve;
  templateResolve = null;
  if (r) r(item || null);
}

export function isTemplatePickerOpen() {
  return !templateOverlay.classList.contains('hidden');
}

function templateKeydown(e) {
  if (templateOverlay.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveTemplateSel(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveTemplateSel(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    closeTemplatePicker(templateItems[templateSel]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeTemplatePicker(null);
  } else {
    return;
  }
  e.stopPropagation();
}

async function pickTemplate() {
  const list = await window.wired.listTemplates();
  templateItems = Array.isArray(list) ? list : [];
  templateSel = 0;
  templateListEl.innerHTML = '';
  if (templateItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = 'no template in the folder';
    templateListEl.appendChild(empty);
  }
  templateItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'palette-row' + (i === 0 ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'palette-label';
    label.textContent = item.name;
    const hint = document.createElement('span');
    hint.className = 'palette-hint';
    hint.textContent = item.file;
    row.appendChild(label);
    row.appendChild(hint);
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      closeTemplatePicker(item);
    });
    templateListEl.appendChild(row);
  });
  templateOverlay.classList.remove('hidden');
  window.addEventListener('keydown', templateKeydown, true);
  return new Promise((resolve) => {
    templateResolve = resolve;
  });
}

templateOverlay.addEventListener('mousedown', (e) => {
  if (e.target === templateOverlay) closeTemplatePicker(null);
});

document.getElementById('btn-template-folder').addEventListener('click', () => window.wired.openTemplatesFolder());

// Puts the caret where the {{cursor}} was. The trick: reopen the content with an
// invisible token, find the token in the rendered DOM, remove it from the text
// node and leave the caret exactly there. If the token does not survive the
// render, the clean content is put back and the caret ends up at the end
// (declared best effort).
function placeCursorAtMarker(pane, withMarker, clean) {
  if (!pane || !pane.vditor) return;
  if (withMarker === clean) {
    pane.vditor.focus();
    return;
  }
  pane.vditor.setValue(withMarker);
  setTimeout(() => {
    const root = pane.el.querySelector('.vditor-ir .vditor-reset');
    let found = false;
    if (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.nodeValue.indexOf(CURSOR_TOKEN);
        if (i === -1) continue;
        node.nodeValue = node.nodeValue.slice(0, i) + node.nodeValue.slice(i + CURSOR_TOKEN.length);
        try {
          const range = document.createRange();
          range.setStart(node, i);
          range.collapse(true);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          if (node.parentElement) node.parentElement.scrollIntoView({ block: 'center' });
          found = true;
        } catch {}
        break;
      }
    }
    if (!found) pane.vditor.setValue(clean);
    setPaneDirty(pane, false);
    refreshFmPanel(pane);
  }, 120);
}

// Flow: pick the template, name the file, answer the questions, and only then
// create. Cancelling (Esc or an empty field) at any step leaves nothing on disk,
// because the file is only born after the last answer.
export async function newFromTemplate(targetDir) {
  const dir = targetDir || getSelectedDir() || getTreeRoot();
  const tpl = await pickTemplate();
  if (!tpl) return;
  const read = await window.wired.readTemplate(tpl.file);
  if (!read.ok) {
    alert('Could not read the template: ' + read.error);
    return;
  }
  const suggestion = TEMPLATE_SUGGESTION[tpl.file.toLowerCase()] || 'untitled.md';
  let name = await askInput('new from ' + tpl.name + (dir ? ' in ' + baseName(dir) : ''), suggestion, 'create');
  if (!name) return;
  if (!/\.(md|markdown)$/i.test(name)) name += '.md';
  const answers = {};
  for (const label of templateQuestions(read.content)) {
    const answer = await askInput(label, '', 'ok');
    if (answer === null) return;
    answers[label] = answer;
  }
  const base = {
    date: today(),
    time: timeNow(),
    title: name.replace(/\.(md|markdown)$/i, ''),
    folder: dir ? baseName(dir) : '',
    answers
  };
  const withMarker = applyVariables(read.content, Object.assign({ cursor: CURSOR_TOKEN }, base));
  const clean = withMarker.split(CURSOR_TOKEN).join('');
  // No folder open: the text goes into the untitled buffer, like "new file".
  if (!dir) {
    newFile();
    const pane = activePane();
    if (pane && pane.vditor) {
      placeCursorAtMarker(pane, withMarker, clean);
      setPaneDirty(pane, true);
    }
    return;
  }
  const target = dir + '\\' + name;
  const created = await window.wired.createFile(target);
  if (!created.ok) {
    alert('Could not create the file: ' + created.error);
    return;
  }
  const written = await window.wired.writeFile(target, clean);
  if (!written.ok) {
    alert('Could not write the template into the file: ' + written.error);
    return;
  }
  await openPath(target, false);
  placeCursorAtMarker(activePane(), withMarker, clean);
}
