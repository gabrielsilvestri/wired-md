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
import { registerPaletteAction } from './palette.js';
import { notify } from './toast.js';

const templateOverlay = document.getElementById('template-overlay');
const templateListEl = document.getElementById('template-list');
const templateHeadEl = document.getElementById('template-head');
const inputOverlay = document.getElementById('input-overlay');

let templateItems = []; // [{ file, name }] currently on screen
let templateSel = 0;
let templateResolve = null;
let templateMode = 'pick'; // 'pick' creates a file from the template, 'manage' edits the templates

const TEMPLATE_HEAD = {
  pick: 'pick a template (arrows navigate, Enter creates, Esc cancels)',
  manage: 'manage templates (arrows navigate, Enter opens for editing, Esc closes)'
};

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
  // The management buttons ask for a name in the app's own dialog WITHOUT
  // closing the picker underneath. This listener runs in the capture phase, so
  // without this line the Enter that confirms the name would also pick a row.
  if (!inputOverlay.classList.contains('hidden')) return;
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

// Redraws the list from disk, keeping the selection on the same file when it is
// still there (a rename or a delete moves it as little as possible).
async function renderTemplateList(keepFile) {
  const list = await window.wired.listTemplates();
  templateItems = Array.isArray(list) ? list : [];
  const at = keepFile ? templateItems.findIndex((t) => t.file === keepFile) : -1;
  templateSel = at !== -1 ? at : Math.max(0, Math.min(templateSel, templateItems.length - 1));
  templateListEl.innerHTML = '';
  if (templateItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = 'no template in the folder';
    templateListEl.appendChild(empty);
  }
  templateItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'palette-row' + (i === templateSel ? ' selected' : '');
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
      // In management mode a click only selects: the footer buttons act on the
      // selected row, so closing on the first click would make them unreachable
      // with the mouse. A double click opens the template for editing.
      if (templateMode === 'manage') {
        templateSel = i;
        markTemplateSel();
        return;
      }
      closeTemplatePicker(item);
    });
    row.addEventListener('dblclick', (e) => {
      e.preventDefault();
      closeTemplatePicker(item);
    });
    templateListEl.appendChild(row);
  });
}

function openTemplateOverlay(mode) {
  templateMode = mode === 'manage' ? 'manage' : 'pick';
  templateHeadEl.textContent = TEMPLATE_HEAD[templateMode];
  templateOverlay.classList.remove('hidden');
  window.removeEventListener('keydown', templateKeydown, true);
  window.addEventListener('keydown', templateKeydown, true);
  return new Promise((resolve) => {
    templateResolve = resolve;
  });
}

async function pickTemplate(mode) {
  templateSel = 0;
  await renderTemplateList(null);
  return openTemplateOverlay(mode);
}

templateOverlay.addEventListener('mousedown', (e) => {
  if (e.target === templateOverlay) closeTemplatePicker(null);
});

// --- managing the templates from the picker footer ---
// Icon buttons, English tooltips. Every step can be cancelled and cancelling
// leaves nothing on disk: the file is only touched after the last answer.

const STARTER_TEMPLATE = '# {{title}}\n\n{{cursor}}\n';

function selectedTemplate() {
  return templateItems[templateSel] || null;
}

function templateFileName(name) {
  return /\.(md|markdown)$/i.test(name) ? name : name + '.md';
}

async function newTemplate() {
  const name = await askInput('new template', 'untitled.md', 'create');
  if (!name) return;
  const file = templateFileName(name);
  const res = await window.wired.createTemplate(file, STARTER_TEMPLATE);
  if (!res.ok) {
    notify('Could not create the template: ' + res.error);
    return;
  }
  await renderTemplateList(file);
}

async function renameTemplate() {
  const item = selectedTemplate();
  if (!item) return;
  const name = await askInput('rename ' + item.name, item.file, 'rename');
  if (!name) return;
  const file = templateFileName(name);
  if (file === item.file) return;
  const res = await window.wired.renameTemplate(item.file, file);
  if (!res.ok) {
    notify('Could not rename the template: ' + res.error);
    return;
  }
  await renderTemplateList(file);
}

// Deleting goes to the Recycle Bin (shell.trashItem), never unlink: a template
// the user wrote is never destroyed by this app.
async function deleteTemplate() {
  const item = selectedTemplate();
  if (!item) return;
  if (!confirm('Move the template "' + item.file + '" to the Recycle Bin?')) return;
  const res = await window.wired.trashTemplate(item.file);
  if (!res.ok) {
    notify('Could not move the template to the Recycle Bin: ' + res.error);
    return;
  }
  await renderTemplateList(null);
}

// Opens the template file itself in a pane, so it is edited with the same editor
// as everything else instead of a second, worse one inside a modal.
async function editTemplate(item) {
  const target = item || selectedTemplate();
  if (!target) return;
  const res = await window.wired.templatePath(target.file);
  if (!res.ok) {
    notify('Could not locate the template: ' + res.error);
    return;
  }
  closeTemplatePicker(null);
  await openPath(res.path, false);
}

// The picker in management mode. Enter opens the selected template for editing.
export async function manageTemplates() {
  const chosen = await pickTemplate('manage');
  if (chosen) await editTemplate(chosen);
}

document.getElementById('btn-template-folder').addEventListener('click', () => window.wired.openTemplatesFolder());
document.getElementById('btn-template-new').addEventListener('click', () => void newTemplate());
document.getElementById('btn-template-rename').addEventListener('click', () => void renameTemplate());
document.getElementById('btn-template-delete').addEventListener('click', () => void deleteTemplate());
document.getElementById('btn-template-edit').addEventListener('click', () => void editTemplate(null));

// The wording is load bearing. The palette ranks by fuzzy score, and a bare
// "manage templates" outranks "new from template" for the query "template",
// which would put the management command in front of the one people reach for
// every day. Naming what it acts on (the FILES) keeps the everyday command on
// top and says more besides.
registerPaletteAction({ label: 'manage the template files', run: () => void manageTemplates() });

// The end to end suite drives management through the same seam the buttons use.
window.manageTemplates = manageTemplates;

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
  const tpl = await pickTemplate('pick');
  if (!tpl) return;
  const read = await window.wired.readTemplate(tpl.file);
  if (!read.ok) {
    notify('Could not read the template: ' + read.error);
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
    notify('Could not create the file: ' + created.error);
    return;
  }
  const written = await window.wired.writeFile(target, clean);
  if (!written.ok) {
    notify('Could not write the template into the file: ' + written.error);
    return;
  }
  await openPath(target, false);
  placeCursorAtMarker(activePane(), withMarker, clean);
}
