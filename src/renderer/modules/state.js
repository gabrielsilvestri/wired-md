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
// Each pane owns its Vditor instance, its path and its dirty flag.

export const MAX_PANES = 4;
export const panes = []; // { id, el, titleEl, path, dirty, vditor, ready, pendingPath }

let activePaneId = null;
let paneSeq = 0;

export function nextPaneId() {
  return ++paneSeq;
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

// Order of use, most recent first: decides which panes stay open when they no
// longer all fit comfortably in the window.
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
