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
// Table editing is a pane level editor feature like this panel, and this is
// where the module graph reaches it: panes.js pulls the properties panel in, and
// the properties panel pulls the tables in. Nothing else imports tables.js.
import './tables.js';

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

const COMMON_MODELS = ['sonnet', 'opus', 'haiku', 'fable', 'inherit'];
const SKILL_DESCRIPTION_MAX = 1536;
// A full model ID (claude-sonnet-5-5 and the like) is as valid as an alias.
const MODEL_ID = /^claude-[a-z0-9.-]+$/i;

// Keys that look like the ones that matter: a silent typo is what breaks agents.
const FM_LOOKALIKES = {
  Name: 'name', NAME: 'name', naem: 'name',
  Description: 'description', describe: 'description', desc: 'description', descript: 'description',
  Tools: 'tools', tool: 'tools',
  Model: 'model', models: 'model'
};

// skill: SKILL.md. subagent: a file inside a folder called agents, or one with
// name next to tools/model. command: a file under a .claude/commands folder
// (subfolders namespace it). Everything else is generic (YAML validity only).
export function fmSchema(p, keys) {
  const base = p ? baseName(p).toLowerCase() : '';
  const folder = p ? baseName(dirName(p)).toLowerCase() : '';
  if (base === 'skill.md') return 'skill';
  if (folder === 'agents') return 'subagent';
  if (p && /[\\/]\.claude[\\/]commands[\\/]/i.test(p)) return 'command';
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
  if (schema === 'command') return fmValidateCommand(entries, keys);

  const name = fmEntry(entries, 'name');
  if (!name) warnings.push('the name key is missing');
  else if (typeof name.value !== 'string' || name.value.trim() === '') warnings.push('name is empty');
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.value.trim())) warnings.push('name should be kebab-case: lowercase, digits and hyphens, no spaces');

  const desc = fmEntry(entries, 'description');
  if (!desc) warnings.push('the description key is missing');
  else if (typeof desc.value !== 'string' || desc.value.trim() === '') warnings.push('description is empty');

  // Claude Code documents a 1,536 character limit for a skill's description
  // and when_to_use together (code.claude.com docs, skills page).
  if (schema === 'skill') {
    const when = fmEntry(entries, 'when_to_use');
    const len = (desc && typeof desc.value === 'string' ? desc.value.length : 0) + (when && typeof when.value === 'string' ? when.value.length : 0);
    if (len > SKILL_DESCRIPTION_MAX) warnings.push('description and when_to_use add up to ' + len.toLocaleString('en-US') + ' characters, over the documented limit of ' + SKILL_DESCRIPTION_MAX.toLocaleString('en-US'));
  }

  const tools = fmEntry(entries, 'tools');
  if (tools && tools.kind !== 'list' && typeof tools.value !== 'string') warnings.push('tools should be a list or a comma separated string');

  modelWarning(entries, warnings);
  lookalikeWarnings(keys, warnings);
  return warnings;
}

function modelWarning(entries, warnings) {
  const model = fmEntry(entries, 'model');
  const v = model && typeof model.value === 'string' ? model.value.trim() : '';
  if (v && !COMMON_MODELS.includes(v.toLowerCase()) && !MODEL_ID.test(v)) {
    warnings.push('model "' + v + '" is not one of the common ones (' + COMMON_MODELS.join(', ') + ') or a claude- model ID');
  }
}

function lookalikeWarnings(keys, warnings) {
  for (const k of keys) {
    const right = FM_LOOKALIKES[k];
    if (right && !keys.includes(right)) warnings.push('"' + k + '" looks like a typo of "' + right + '"');
    else if (right) warnings.push('"' + k + '" is redundant next to "' + right + '"');
  }
}

// A custom slash command: every key is optional, and the file name IS the
// command name, so a name key is the one mistake worth flagging.
function fmValidateCommand(entries, keys) {
  const warnings = [];
  if (fmEntry(entries, 'name')) warnings.push('a command is named after its file; the name key is ignored here');
  const desc = fmEntry(entries, 'description');
  if (desc && (typeof desc.value !== 'string' || desc.value.trim() === '')) warnings.push('description is empty (the / menu shows it)');
  const tools = fmEntry(entries, 'allowed-tools');
  if (tools && tools.kind !== 'list' && typeof tools.value !== 'string') warnings.push('allowed-tools should be a list or a comma separated string');
  modelWarning(entries, warnings);
  lookalikeWarnings(keys.filter((k) => k !== 'Name' && k !== 'NAME' && k !== 'naem'), warnings);
  return warnings;
}

const FM_SCHEMA_LABEL = { skill: 'skill', subagent: 'subagent', command: 'command', generic: 'generic' };

// The keys each schema actually reads. They are offered first in the add row, so
// the common case is picking a real key instead of typing one and finding out
// later that the agent ignored it.
const FM_SCHEMA_KEYS = {
  skill: ['name', 'description', 'license', 'allowed-tools', 'metadata', 'when_to_use', 'argument-hint', 'model', 'disable-model-invocation', 'context'],
  subagent: ['name', 'description', 'tools', 'model', 'color', 'disallowedTools', 'permissionMode', 'maxTurns', 'skills', 'effort'],
  command: ['description', 'argument-hint', 'allowed-tools', 'model', 'disable-model-invocation', 'effort'],
  generic: []
};

const FM_GENERIC_KEYS = ['title', 'tags', 'date', 'author', 'status'];

// Suggestions for the add row: the schema keys still missing come first, then
// the generic ones. A key that is already in the block is never suggested.
export function fmSuggestions(schema, keys) {
  const have = keys.slice();
  const out = [];
  for (const k of (FM_SCHEMA_KEYS[schema] || []).concat(FM_GENERIC_KEYS)) {
    if (have.indexOf(k) === -1 && out.indexOf(k) === -1) out.push(k);
  }
  return out;
}

const FM_KINDS = [
  ['string', 'text'],
  ['number', 'number'],
  ['list', 'list'],
  ['bool', 'boolean']
];

const ICON_PLUS = ['M12 5v14', 'M5 12h14'];

function fmWarnRow(msg) {
  const row = document.createElement('div');
  row.className = 'fm-warn';
  // Announced, never blocking: the row is the whole warning surface here (no
  // popup, by design), so it has to reach a screen reader as a live status.
  row.setAttribute('role', 'status');
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

// The single write path of the panel. It reads the block out of the document,
// hands the raw YAML to `edit` (one of the fm* functions in the preload, which
// are the only place the yaml Document lives), and writes the result back.
//
// The whole block is re-emitted by the yaml serializer, but order, comments,
// unknown keys and nested maps come from the original Document: only what was
// touched changes.
//
// `redraw` says whether the rows have to be rebuilt. Editing a value must NOT
// redraw (the focus would jump out from under the fingers of whoever is typing);
// renaming a key or adding one changes the shape of the panel, so it must.
function fmEdit(pane, edit, redraw) {
  if (!pane.vditor || !pane.ready) return false;
  const text = pane.vditor.getValue();
  const split = splitFrontmatter(text);
  if (!split) return false;
  const res = edit(split.raw);
  if (!res || !res.ok) {
    renderFmWarnings(pane, ['could not write to the frontmatter: ' + ((res && res.error) || 'unknown error')]);
    return false;
  }
  const updated = '---\n' + res.raw + '\n---\n' + split.body;
  if (updated === text) return true;
  pane.fmQuiet = true; // this very edit must not rebuild the panel from the document
  pane.vditor.setValue(updated);
  setPaneDirty(pane, true);
  if (redraw) {
    refreshFmPanel(pane);
  } else {
    // Revalidates without redrawing the rows (focus stays where the person types).
    const parsed = window.wired.fmParse(res.raw);
    if (parsed.ok) renderFmWarnings(pane, fmValidate(fmSchema(pane.path, parsed.entries.map((e) => e.key)), parsed.entries));
  }
  setTimeout(() => {
    pane.fmQuiet = false;
  }, 500);
  return true;
}

function fmCommit(pane, key, kind, input) {
  fmEdit(pane, (raw) => window.wired.fmSet(raw, key, kind, fmControlValue(input, kind)), false);
}

function fmCommitRename(pane, oldKey, newKey) {
  return fmEdit(pane, (raw) => window.wired.fmRename(raw, oldKey, newKey), true);
}

function fmCommitAdd(pane, key, kind) {
  return fmEdit(pane, (raw) => window.wired.fmAdd(raw, key, kind), true);
}

function renderFmWarnings(pane, warnings) {
  const box = pane.fmEl.querySelector('.fm-warns');
  if (!box) return;
  box.innerHTML = '';
  for (const a of warnings) box.appendChild(fmWarnRow(a));
}

// Renaming a key in place: the label becomes a text field, and Enter (or moving
// the focus away) commits. Esc puts the label back and writes nothing. The label
// itself stays a label the rest of the time, so reading the panel never looks
// like a form.
function beginRename(pane, label, key) {
  if (label.dataset.editing === '1') return;
  label.dataset.editing = '1';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'fm-key-input';
  inp.spellcheck = false;
  inp.value = key;
  inp.dataset.key = key;
  inp.title = 'Rename the key (Enter commits, Esc cancels)';
  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    const next = inp.value.trim();
    label.dataset.editing = '';
    if (inp.parentElement) inp.replaceWith(label);
    if (commit && next && next !== key) fmCommitRename(pane, key, next);
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => finish(true));
  label.replaceWith(inp);
  inp.focus();
  inp.select();
}

function fmRow(pane, entry) {
  const row = document.createElement('div');
  row.className = 'fm-row';
  const label = document.createElement('label');
  label.className = 'fm-key';
  label.textContent = entry.key;
  label.title = entry.key + ' (click to rename)';
  label.addEventListener('click', (e) => {
    e.preventDefault();
    beginRename(pane, label, entry.key);
  });
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

// The row at the bottom that adds a key: a name (with the schema suggestions),
// the kind of the value, and one icon button. The key is created with the empty
// value of its kind, so the row that appears right above is immediately
// editable. This row is never a .fm-row: the rows are the keys of the file.
function fmAddRow(pane, schema, entries) {
  const row = document.createElement('div');
  row.className = 'fm-add-row';

  const key = document.createElement('input');
  key.type = 'text';
  key.className = 'fm-add-key';
  key.spellcheck = false;
  key.placeholder = 'add a key...';
  const listId = 'fm-add-list-' + pane.id;
  key.setAttribute('list', listId);

  const list = document.createElement('datalist');
  list.id = listId;
  for (const s of fmSuggestions(schema, entries.map((e) => e.key))) {
    const opt = document.createElement('option');
    opt.value = s;
    list.appendChild(opt);
  }

  const kind = document.createElement('select');
  kind.className = 'fm-add-kind';
  kind.title = 'Type of the new key';
  kind.setAttribute('aria-label', 'Type of the new key');
  for (const [value, label] of FM_KINDS) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    kind.appendChild(opt);
  }

  const btn = document.createElement('button');
  btn.className = 'fm-add-btn';
  btn.title = 'Add the key';
  btn.setAttribute('aria-label', 'Add the key');
  btn.appendChild(svgIcon(13, ICON_PLUS));

  const submit = () => {
    const name = key.value.trim();
    if (!name) return;
    // On success the panel is rebuilt, which is what clears this row.
    fmCommitAdd(pane, name, kind.value);
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    submit();
  });
  key.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
    e.stopPropagation();
  });

  row.appendChild(key);
  row.appendChild(list);
  row.appendChild(kind);
  row.appendChild(btn);
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
  rows.appendChild(fmAddRow(pane, schema, entries));
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
