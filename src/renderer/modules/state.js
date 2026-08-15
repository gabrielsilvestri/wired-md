// Shared renderer state: the config object, the pane registry and the pane MRU.
//
// The config defaults are COMPOSED: every module registers the keys it owns
// with registerConfigDefaults, so a new feature adds its own defaults in its own
// file instead of everyone editing one growing literal (and two features added
// in parallel never collide on the same line).

export const config = {};

export function registerConfigDefaults(defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in config)) config[k] = v;
  }
}

registerConfigDefaults({
  theme: 'wired',
  accent: null,
  fontBody: '',
  fontCode: '',
  fontSize: 15,
  snippets: [],
  recentFiles: []
});

export async function saveConfig() {
  await window.wired.setConfig(config);
}

export async function loadConfig() {
  try {
    Object.assign(config, await window.wired.getConfig());
  } catch {}
  return config;
}

// --- pane registry ---
// A PANE is one open file: its Vditor instance, its path and its dirty flag.
// Every pane belongs to a GROUP (an editor group in the VS Code sense): a
// column with its own tab bar, showing one pane at a time. Groups sit side by
// side, separated by a draggable resizer.

export const MAX_GROUPS = 3; // horizontal side by side only, no grid
export const panes = []; // { id, groupId, el, tabEl, titleEl, path, dirty, vditor, ready }
export const groups = []; // { id, el, tabsEl, bodyEl, size }

let activePaneId = null;
let paneSeq = 0;
let groupSeq = 0;

export function nextPaneId() {
  return ++paneSeq;
}

export function nextGroupId() {
  return ++groupSeq;
}

export function groupById(id) {
  return groups.find((g) => g.id === id) || null;
}

export function panesOfGroup(id) {
  return panes.filter((p) => p.groupId === id);
}

// The group that owns the active pane; with no pane open, the first group.
export function activeGroup() {
  const p = activePane();
  return (p && groupById(p.groupId)) || groups[0] || null;
}

export function getActivePaneId() {
  return activePaneId;
}

export function setActivePaneId(id) {
  activePaneId = id;
}

export function activePane() {
  return panes.find((p) => p.id === activePaneId) || panes[0] || null;
}

// Order of use, most recent first: which tab a group falls back to when the
// current one closes, and which pane wins when a file is already open.
let paneMru = [];

export function touchMru(id) {
  paneMru = [id, ...paneMru.filter((x) => x !== id)];
}

export function dropFromMru(id) {
  paneMru = paneMru.filter((x) => x !== id);
}

export function mruOrder() {
  return paneMru;
}

// --- small path helpers, used everywhere ---

export function baseName(p) {
  return p.split(/[\\/]/).pop();
}

export function dirName(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
