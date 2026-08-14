// Properties panel for the YAML frontmatter block, one per pane.
//
// What this is: a SYNCHRONIZED DOUBLE VIEW. The --- block stays visible in the
// document (Vditor IR has a dedicated node for yaml-front-matter and round trips
// it exactly) and the panel is the structured view on top of it. Hiding the node
// inside the editor was rejected: it is contenteditable, so display:none still
// lets the caret walk into it with Ctrl+Home, arrow up or Ctrl+A, and the person
// would type blind. Editing in the panel rewrites the block in the document;
// editing the document rebuilds the panel (debounced).
//
// Warnings are a compact inline row, never a popup, and they never block typing
// or saving.

import { config, saveConfig, registerConfigDefaults, panes, baseName, dirName } from './state.js';
import { svgIcon, ICON_ALERT } from './icons.js';
import { setPaneDirty } from './panes.js';

registerConfigDefaults({ frontmatterPanel: true });

// Frontmatter only counts at the very start of the file, between one --- line
// and the next.
const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text) {
  if (!text || !text.startsWith('---')) return null;
  const m = FM_RE.exec(text);
  if (!m) return null;
  return { raw: m[1], block: m[0], body: text.slice(m[0].length) };
}

const COMMON_MODELS = ['sonnet', 'opus', 'haiku', 'inherit'];

// Keys that look like the ones that matter: a silent typo is what breaks agents.
const FM_LOOKALIKES = {
  Name: 'name', NAME: 'name', naem: 'name',
  Description: 'description', describe: 'description', desc: 'description', descript: 'description',
  Tools: 'tools', tool: 'tools',
  Model: 'model', models: 'model'
};

// skill: SKILL.md. subagent: a file inside a folder called agents, or one with
// name next to tools/model. Everything else is generic (YAML validity only).
export function fmSchema(p, keys) {
  const base = p ? baseName(p).toLowerCase() : '';
  const folder = p ? baseName(dirName(p)).toLowerCase() : '';
  if (base === 'skill.md') return 'skill';
  if (folder === 'agents') return 'subagent';
  if (keys.includes('name') && (keys.includes('tools') || keys.includes('model'))) return 'subagent';
  return 'generic';
}

function fmEntry(entries, key) {
  return entries.find((e) => e.key === key) || null;
}

// Returns the list of warnings (short sentences). It never blocks anything.
export function fmValidate(schema, entries) {
  const warnings = [];
  const keys = entries.map((e) => e.key);
  if (schema === 'generic') return warnings;

  const name = fmEntry(entries, 'name');
  if (!name) warnings.push('the name key is missing');
  else if (typeof name.value !== 'string' || name.value.trim() === '') warnings.push('name is empty');
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.value.trim())) warnings.push('name should be kebab-case: lowercase, digits and hyphens, no spaces');

  const desc = fmEntry(entries, 'description');
  if (!desc) warnings.push('the description key is missing');
  else if (typeof desc.value !== 'string' || desc.value.trim() === '') warnings.push('description is empty');

  const tools = fmEntry(entries, 'tools');
  if (tools && tools.kind !== 'list' && typeof tools.value !== 'string') warnings.push('tools should be a list or a comma separated string');

  const model = fmEntry(entries, 'model');
  if (model && typeof model.value === 'string' && model.value.trim() && !COMMON_MODELS.includes(model.value.trim().toLowerCase())) {
    warnings.push('model "' + model.value.trim() + '" is not one of the common ones (' + COMMON_MODELS.join(', ') + ')');
  }

  for (const k of keys) {
    const right = FM_LOOKALIKES[k];
    if (right && !keys.includes(right)) warnings.push('"' + k + '" looks like a typo of "' + right + '"');
    else if (right) warnings.push('"' + k + '" is redundant next to "' + right + '"');
  }
  return warnings;
}

const FM_SCHEMA_LABEL = { skill: 'skill', subagent: 'subagent', generic: 'generic' };

function fmWarnRow(msg) {
  const row = document.createElement('div');
  row.className = 'fm-warn';
  const ico = svgIcon(12, ICON_ALERT);
  ico.classList.add('fm-warn-ico');
  const txt = document.createElement('span');
  txt.textContent = msg;
  row.appendChild(ico);
  row.appendChild(txt);
  return row;
}

// The value of a row control, in the shape fmSet expects.
function fmControlValue(input, kind) {
  if (kind === 'bool') return input.checked;
  if (kind === 'list') {
    return input.value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  return input.value;
}

// Rewrites the key in the block in the document. The whole block is re-emitted
// by the yaml serializer, but order, comments, unknown keys and nested maps come
// from the original Document: only the value that was touched changes.
function fmCommit(pane, key, kind, input) {
  if (!pane.vditor || !pane.ready) return;
  const text = pane.vditor.getValue();
  const split = splitFrontmatter(text);
  if (!split) return;
  const res = window.wired.fmSet(split.raw, key, kind, fmControlValue(input, kind));
  if (!res.ok) {
    renderFmWarnings(pane, ['could not write to the frontmatter: ' + res.error]);
    return;
  }
  const updated = '---\n' + res.raw + '\n---\n' + split.body;
  if (updated === text) return;
  pane.fmQuiet = true; // this very edit must not rebuild the panel
  pane.vditor.setValue(updated);
  setPaneDirty(pane, true);
  // Revalidates without redrawing the rows (focus stays where the person types).
  const parsed = window.wired.fmParse(res.raw);
  if (parsed.ok) renderFmWarnings(pane, fmValidate(fmSchema(pane.path, parsed.entries.map((e) => e.key)), parsed.entries));
  setTimeout(() => {
    pane.fmQuiet = false;
  }, 500);
}

function renderFmWarnings(pane, warnings) {
  const box = pane.fmEl.querySelector('.fm-warns');
  if (!box) return;
  box.innerHTML = '';
  for (const a of warnings) box.appendChild(fmWarnRow(a));
}

function fmRow(pane, entry) {
  const row = document.createElement('div');
  row.className = 'fm-row';
  const label = document.createElement('label');
  label.className = 'fm-key';
  label.textContent = entry.key;
  label.title = entry.key;
  row.appendChild(label);

  if (entry.kind === 'other') {
    // A nested map or a structure the panel cannot represent: shown read only
    // and left untouched in the file.
    const val = document.createElement('div');
    val.className = 'fm-val fm-other';
    val.textContent = entry.preview || '(structure preserved)';
    val.title = 'structure preserved exactly as it is in the file';
    row.appendChild(val);
    return row;
  }

  if (entry.kind === 'bool') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'fm-val fm-bool';
    cb.checked = !!entry.value;
    cb.addEventListener('change', () => fmCommit(pane, entry.key, 'bool', cb));
    row.appendChild(cb);
    return row;
  }

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'fm-val';
  inp.spellcheck = false;
  if (entry.kind === 'list') {
    inp.value = (entry.value || []).map((v) => (v === null ? '' : String(v))).join(', ');
    inp.placeholder = 'comma separated items';
  } else {
    inp.value = entry.value === null || entry.value === undefined ? '' : String(entry.value);
  }
  inp.dataset.key = entry.key;
  inp.addEventListener('change', () => fmCommit(pane, entry.key, entry.kind, inp));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fmCommit(pane, entry.key, entry.kind, inp);
    }
    e.stopPropagation();
  });
  row.appendChild(inp);
  return row;
}

export function refreshFmPanel(pane) {
  if (!pane || !pane.fmEl) return;
  const el = pane.fmEl;
  el.innerHTML = '';
  const text = pane.vditor && pane.ready ? pane.vditor.getValue() : '';
  const split = splitFrontmatter(text);
  if (!split || config.frontmatterPanel === false) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');

  const parsed = window.wired.fmParse(split.raw);
  const entries = parsed.ok ? parsed.entries : [];
  const schema = fmSchema(pane.path, entries.map((e) => e.key));

  const head = document.createElement('div');
  head.className = 'fm-head';
  const title = document.createElement('span');
  title.className = 'fm-title';
  title.textContent = 'properties';
  const tag = document.createElement('span');
  tag.className = 'fm-schema';
  tag.textContent = FM_SCHEMA_LABEL[schema];
  tag.title = 'schema applied to this file';
  head.appendChild(title);
  head.appendChild(tag);
  el.appendChild(head);

  const rows = document.createElement('div');
  rows.className = 'fm-rows';
  el.appendChild(rows);

  const warns = document.createElement('div');
  warns.className = 'fm-warns';
  el.appendChild(warns);

  // Invalid YAML: the panel degrades to a raw read only view with the error on top.
  if (!parsed.ok || parsed.isMap === false) {
    const pre = document.createElement('pre');
    pre.className = 'fm-raw';
    pre.textContent = split.raw;
    rows.appendChild(pre);
    renderFmWarnings(pane, [parsed.ok ? 'the frontmatter is not a map of keys; the panel is read only' : 'invalid YAML: ' + parsed.error]);
    return;
  }

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fm-empty';
    empty.textContent = 'empty frontmatter';
    rows.appendChild(empty);
  }
  for (const e of entries) rows.appendChild(fmRow(pane, e));
  renderFmWarnings(pane, fmValidate(schema, entries));
}

export function scheduleFmRefresh(pane) {
  if (pane.fmQuiet) return;
  clearTimeout(pane.fmTimer);
  pane.fmTimer = setTimeout(() => {
    // Never redraw under the fingers of someone typing in the panel.
    if (pane.fmEl && pane.fmEl.contains(document.activeElement)) return;
    refreshFmPanel(pane);
  }, 450);
}

export function refreshAllFmPanels() {
  for (const p of panes) refreshFmPanel(p);
}

export function toggleFrontmatterPanel(forceOn) {
  const on = forceOn === undefined ? config.frontmatterPanel === false : !!forceOn;
  config.frontmatterPanel = on;
  saveConfig();
  refreshAllFmPanels();
}
