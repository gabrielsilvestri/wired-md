// First run welcome and the AI CLI picker.
//
// The welcome is one compact screen with three picks: the AI CLI the bridge
// brings up, the theme and the document font. Every pick commits live, the same
// way the settings panel does, so "start writing" and "skip" (or Esc) only differ
// in wording: both close it and set `onboarded`, and nothing has to be reverted.
//
// The CLI picker is built twice from the same code: inside the welcome and in
// the "terminal and AI" settings pane. Both write `config.aiCliCommand`, the key
// the bridge already reads, and the bridge still never presses Enter.

import { config, registerConfigDefaults, saveConfig, activePane } from './state.js';
import { applyTheme, applyCustom, onThemeApplied } from './theme.js';
import { aiCliCommand, applyAiCliLabels } from './ai-bridge.js';
import { registerPaletteAction, isPaletteOpen } from './palette.js';
import { BUNDLED_FONTS } from './settings.js';
import { APP_NAME } from './titlebar.js';
import { svgIcon, ICON_X } from './icons.js';

registerConfigDefaults({ onboarded: false });

const ICON_CHECK = ['M20 6 9 17l-5-5'];
const ICON_RESCAN = ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'];
const ICON_GITHUB = [
  'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
  'M9 18c-4.51 2-5-2-7-2'
];
const ICON_COFFEE = ['M10 2v2', 'M14 2v2', 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1', 'M6 2v2'];

// The links the main process allows, and nothing else (src/main/ipc/onboarding.js).
const REPO_URL = 'https://github.com/gabrielsilvestri/wired-md';
const COFFEE_URL = 'https://buymeacoffee.com/gabrielsilvestri';

// The document font when fontBody is empty (--font-body-default in styles.css).
const DEFAULT_DOC_FONT = 'Mona Sans';

function el(tag, props, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined) continue;
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children || []) if (c) node.appendChild(c);
  return node;
}

function iconButton(className, title, icon, size) {
  const b = el('button', { className, type: 'button', title, 'aria-label': title });
  b.appendChild(svgIcon(size || 14, icon));
  return b;
}

// --- detection (main scans PATH; nothing here ever runs a CLI) ---

let detection = null; // { complete, clis: [{ name, label, found, path }] }
let detecting = null;

export function detectClis(force) {
  if (detecting && !force) return detecting;
  detecting = window.wired
    .detectAiClis()
    .catch(() => ({ complete: false, clis: [] }))
    .then((res) => {
      detection = res && Array.isArray(res.clis) ? res : { complete: false, clis: [] };
      for (const p of pickers) buildCards(p);
      syncAll();
      return detection;
    });
  return detecting;
}

// --- the AI CLI picker ---

const pickers = []; // { host, grid, input, status, cards: Map(name -> button) }
let saveTimer = null;

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveConfig(), 250);
}

function setCliCommand(cmd) {
  config.aiCliCommand = cmd;
  applyAiCliLabels();
  syncAll();
  saveSoon();
}

function buildPicker(host, idPrefix, compact) {
  host.classList.add('cli-picker');
  if (compact) host.classList.add('is-compact');
  const grid = el('div', { className: 'cli-grid', role: 'group', 'aria-label': 'AI CLI' });
  const inputId = idPrefix + '-custom';
  const input = el('input', {
    type: 'text',
    id: inputId,
    className: 'cli-custom-input',
    spellcheck: 'false',
    placeholder: 'e.g. claude --model opus',
    'aria-describedby': idPrefix + '-status'
  });
  const rescan = iconButton('cli-rescan', 'Look for AI CLIs on PATH again', ICON_RESCAN, 13);
  const custom = el('div', { className: 'cli-custom' }, [
    el('label', { for: inputId, text: 'or any command' }),
    input,
    rescan
  ]);
  const status = el('p', { className: 'cli-status', id: idPrefix + '-status', role: 'status', text: 'looking for AI CLIs on PATH...' });
  host.append(grid, custom, status);

  const picker = { host, grid, input, status, cards: new Map() };
  input.addEventListener('input', () => setCliCommand(input.value.trim() || 'claude'));
  input.addEventListener('change', () => saveConfig());
  rescan.addEventListener('click', () => {
    status.textContent = 'looking for AI CLIs on PATH...';
    detectClis(true);
  });
  pickers.push(picker);
  if (detection) buildCards(picker);
  return picker;
}

function buildCards(picker) {
  picker.grid.innerHTML = '';
  picker.cards.clear();
  for (const cli of detection.clis) {
    const mark = el('span', { className: 'cli-mark' + (cli.found ? ' is-found' : '') }, [
      el('span', { className: 'cli-dot', 'aria-hidden': 'true' }),
      el('span', { text: cli.found ? 'found on PATH' : 'not found' })
    ]);
    const tip = cli.found ? 'Use ' + cli.name + ' (' + cli.path + ')' : 'Use ' + cli.name + ' (not found on PATH yet)';
    const card = el('button', { type: 'button', className: 'cli-card', 'data-cli': cli.name, title: tip, 'aria-pressed': 'false' }, [
      el('span', { className: 'cli-name', text: cli.name }),
      el('span', { className: 'cli-label', text: cli.label }),
      mark
    ]);
    card.addEventListener('click', () => {
      picker.input.value = '';
      setCliCommand(cli.name);
    });
    picker.grid.appendChild(card);
    picker.cards.set(cli.name, card);
  }
  const found = detection.clis.filter((c) => c.found).length;
  picker.status.textContent = detection.complete
    ? found + ' of ' + detection.clis.length + ' found on PATH. Any command works, found or not.'
    : 'The PATH scan did not finish. Any command still works.';
}

function syncPicker(picker) {
  const cmd = aiCliCommand();
  for (const [name, card] of picker.cards) {
    const on = name === cmd;
    card.classList.toggle('is-selected', on);
    card.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  // Never rewrite the field under the caret of someone typing in it.
  if (document.activeElement !== picker.input) picker.input.value = picker.cards.has(cmd) ? '' : cmd;
}

// --- the welcome dialog ---

const overlay = el('div', { id: 'onboarding-overlay', className: 'hidden' });
const dialog = el('div', { id: 'onboarding', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'onb-title', tabindex: '-1' });
overlay.appendChild(dialog);

const themeGrid = el('div', { className: 'onb-themes', role: 'group', 'aria-label': 'Theme' });
const fontGrid = el('div', { className: 'onb-fonts', role: 'group', 'aria-label': 'Document font' });
const cliHost = el('div', { id: 'onb-cli' });
const finishBtn = el('button', { type: 'button', id: 'onb-finish', className: 'onb-primary', text: 'start writing' });
const skipBtn = el('button', { type: 'button', id: 'onb-skip', className: 'onb-skip', text: 'skip', title: 'Skip (Esc)' });
const closeBtn = iconButton('onb-close', 'Close (Esc)', ICON_X, 14);
closeBtn.id = 'onb-close';

function section(n, title, hint, body) {
  return el('section', { className: 'onb-section' }, [
    el('h3', {}, [el('span', { className: 'onb-step', 'aria-hidden': 'true', text: String(n) }), el('span', { text: title })]),
    hint ? el('p', { className: 'onb-hint', text: hint }) : null,
    body
  ]);
}

function linkButton(id, text, icon, url) {
  const b = el('button', { type: 'button', id, className: 'onb-link', title: url, 'aria-label': text + ' (opens in your browser)' });
  b.appendChild(svgIcon(14, icon));
  b.appendChild(el('span', { text }));
  // A button, not an <a href>: an anchor would navigate the editor window itself.
  b.addEventListener('click', () => window.wired.openProjectLink(url));
  return b;
}

dialog.append(
  el('header', { className: 'onb-head' }, [
    el('div', {}, [
      el('h2', { id: 'onb-title', text: 'welcome to ' + APP_NAME }),
      el('p', { className: 'onb-lede', text: 'Three picks and you are writing. Settings keeps all of them for later.' })
    ]),
    closeBtn
  ]),
  el('div', { className: 'onb-body' }, [
    section(1, 'your AI CLI', 'The sparkles button types this command into the terminal. It never presses Enter.', cliHost),
    section(2, 'theme', 'Hover to preview, click to keep.', themeGrid),
    section(3, 'document font', null, fontGrid)
  ]),
  el('footer', { className: 'onb-foot' }, [
    el('div', { className: 'onb-links' }, [
      linkButton('onb-link-repo', 'GitHub', ICON_GITHUB, REPO_URL),
      linkButton('onb-link-coffee', 'Buy me a coffee', ICON_COFFEE, COFFEE_URL)
    ]),
    el('div', { className: 'onb-actions' }, [skipBtn, finishBtn])
  ])
);

document.body.appendChild(overlay);
buildPicker(cliHost, 'onb-cli', false);

const aiPane = document.getElementById('ai-cli-picker');
if (aiPane) buildPicker(aiPane, 'set-cli', true);

// --- theme cards, with the swatch drawn from the theme's own variables ---

const themeCss = new Map();

function themeVarsOf(css) {
  const out = {};
  const body = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) if (!(m[1] in out)) out[m[1]] = m[2];
  return out;
}

// Hover previews are serialized: applyTheme is an IPC round trip, and two of
// them racing would leave whichever answered LAST on screen, not the theme the
// pointer is on now. Each queued step applies the latest wish.
let themeWanted = null;
let themeChain = Promise.resolve();

function showTheme(name) {
  themeWanted = name;
  themeChain = themeChain.then(() => applyTheme(themeWanted)).catch(() => {});
  return themeChain;
}

async function fillThemes() {
  let names = [];
  try {
    names = await window.wired.listThemes();
  } catch {}
  themeGrid.innerHTML = '';
  for (const name of names) {
    if (!themeCss.has(name)) {
      try {
        const res = await window.wired.readTheme(name);
        themeCss.set(name, res && res.ok ? res.css : '');
      } catch {
        themeCss.set(name, '');
      }
    }
    const v = themeVarsOf(themeCss.get(name));
    const swatch = el('span', { className: 'onb-swatch', 'aria-hidden': 'true' }, [
      el('span', { className: 'sw-side' }),
      el('span', { className: 'sw-h' }),
      el('span', { className: 'sw-l sw-l1' }),
      el('span', { className: 'sw-l sw-l2' }),
      el('span', { className: 'sw-l sw-l3' })
    ]);
    const props = { '--sw-bg': v['--bg'], '--sw-bg2': v['--bg-2'], '--sw-ink': v['--ink'], '--sw-dim': v['--ink-faint'], '--sw-accent': v['--accent'] };
    for (const [k, val] of Object.entries(props)) if (val) swatch.style.setProperty(k, val);
    const card = el('button', { type: 'button', className: 'onb-theme', 'data-theme': name, title: 'Use the ' + name + ' theme', 'aria-pressed': 'false' }, [
      swatch,
      el('span', { className: 'onb-card-name', text: name })
    ]);
    card.addEventListener('mouseenter', () => showTheme(name));
    card.addEventListener('focus', () => showTheme(name));
    card.addEventListener('click', () => {
      config.theme = name;
      showTheme(name);
      syncAll();
      saveConfig();
    });
    themeGrid.appendChild(card);
  }
  syncAll();
}

// Leaving the row (or tabbing out of it) puts the kept theme back.
themeGrid.addEventListener('mouseleave', () => showTheme(config.theme));
themeGrid.addEventListener('focusout', (e) => {
  if (!themeGrid.contains(e.relatedTarget)) showTheme(config.theme);
});

// --- font cards ---

function docFontNames() {
  return [DEFAULT_DOC_FONT, ...BUNDLED_FONTS.filter((f) => f !== DEFAULT_DOC_FONT)];
}

function fillFonts() {
  fontGrid.innerHTML = '';
  for (const name of docFontNames()) {
    const sample = el('span', { className: 'onb-font-sample', 'aria-hidden': 'true', text: 'Aa' });
    sample.style.fontFamily = '"' + name + '", system-ui, sans-serif';
    const card = el('button', { type: 'button', className: 'onb-font', 'data-font': name, title: name === DEFAULT_DOC_FONT ? 'Write in ' + name + ' (the default)' : 'Write in ' + name, 'aria-pressed': 'false' }, [
      sample,
      el('span', { className: 'onb-card-name', text: name })
    ]);
    card.addEventListener('click', () => {
      config.fontBody = name === DEFAULT_DOC_FONT ? '' : name;
      applyCustom();
      syncAll();
      saveConfig();
    });
    fontGrid.appendChild(card);
  }
  syncAll();
}

function syncAll() {
  for (const p of pickers) syncPicker(p);
  for (const card of themeGrid.querySelectorAll('.onb-theme')) {
    const on = card.dataset.theme === config.theme;
    card.classList.toggle('is-selected', on);
    card.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const font = config.fontBody || DEFAULT_DOC_FONT;
  for (const card of fontGrid.querySelectorAll('.onb-font')) {
    const on = card.dataset.font === font;
    card.classList.toggle('is-selected', on);
    card.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

// A config change made elsewhere (the settings panel, the E2E writing the key
// directly) reaches the cards on the same "config applied" hook the bridge uses.
onThemeApplied(syncAll);

// --- open and close ---

let returnFocus = null;

export function isWelcomeOpen() {
  return !overlay.classList.contains('hidden');
}

// The keyboard starts where the first decision is: the current CLI pick.
function focusFirstPick() {
  const sel = cliHost.querySelector('.cli-card.is-selected') || cliHost.querySelector('.cli-card') || finishBtn;
  sel.focus();
}

export async function openWelcome() {
  if (isWelcomeOpen()) {
    focusFirstPick();
    return;
  }
  returnFocus = document.activeElement;
  overlay.classList.remove('hidden');
  syncAll();
  dialog.focus();
  detectClis();
  await Promise.all([fillThemes(), Promise.resolve(fillFonts())]);
  await detecting;
  if (!isWelcomeOpen()) return;
  if (dialog.contains(document.activeElement) && document.activeElement !== dialog) return;
  focusFirstPick();
}

export function closeWelcome() {
  if (!isWelcomeOpen()) return;
  overlay.classList.add('hidden');
  // Whatever the pointer was previewing, the kept theme is what stays.
  showTheme(config.theme);
  config.onboarded = true;
  clearTimeout(saveTimer);
  saveConfig();
  const back = returnFocus;
  returnFocus = null;
  // The palette input it was opened from is hidden by now; that is no place to
  // send the caret back to.
  if (back && back !== document.body && back.isConnected && back.offsetParent !== null && typeof back.focus === 'function') {
    back.focus();
    return;
  }
  // Opened at boot, nothing had focus yet: "start writing" means the document.
  const pane = activePane();
  if (pane && pane.vditor) pane.vditor.focus();
}

finishBtn.addEventListener('click', closeWelcome);
skipBtn.addEventListener('click', closeWelcome);
closeBtn.addEventListener('click', closeWelcome);

// Esc closes the welcome before the global chain sees it. This listener is
// registered at import time, ahead of the one in app.js, and it stands aside
// while the palette is open on top so Esc closes the palette first.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || !isWelcomeOpen() || isPaletteOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeWelcome();
  },
  true
);

// Tab stays inside the dialog while it is open.
dialog.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const items = [...dialog.querySelectorAll('button, input')].filter((n) => !n.disabled && n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

// A file restored or opened at boot can grab focus after the welcome is up,
// and keys would then land in a document hidden behind the modal. Focus is
// pulled back in, except into the palette, which may sit on top of it.
document.addEventListener('focusin', (e) => {
  if (!isWelcomeOpen() || overlay.contains(e.target) || isPaletteOpen()) return;
  focusFirstPick();
});

// --- the settings pane ---

// The pane is filled when the settings overlay becomes visible, without
// teaching settings.js about this module.
const settingsOverlay = document.getElementById('settings-overlay');
if (settingsOverlay) {
  new MutationObserver(() => {
    if (settingsOverlay.classList.contains('hidden')) return;
    detectClis();
    syncAll();
  }).observe(settingsOverlay, { attributes: true, attributeFilter: ['class'] });
}

registerPaletteAction({ label: 'welcome and setup', run: () => openWelcome() });

// Called once the config is loaded: before that, `onboarded` is only the
// default and would open the welcome for everyone.
export async function initOnboarding() {
  if (config.onboarded) return;
  let auto = false;
  try {
    auto = await window.wired.onboardingAutoOpen();
  } catch {}
  if (auto && !config.onboarded) openWelcome();
}
