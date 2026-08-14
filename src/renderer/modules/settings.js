// Settings panel (the gear in the sidebar footer), in icon tabs: Appearance,
// Editor, Terminal and AI, Shortcuts.
//
// The flagship section is the theme variable panel under Appearance: every
// :root color the active theme declares, editable in place, with a live
// contrast check on every commit. The check is an inline amber row and never a
// popup, and it never refuses an edit. The owner has astigmatism and needs text
// between 4.5:1 and 11:1, which is a thing the app can MEASURE and report; it
// is not a thing the app gets to enforce over its user.

import { config, saveConfig } from './state.js';
import {
  applyTheme, applyCustom, applySnippets,
  themeVars, overridesFor, setOverride, clearOverride, clearAllOverrides,
  hexToRgb, contrastRatio
} from './theme.js';

const settingsOverlay = document.getElementById('settings-overlay');
const selTheme = document.getElementById('sel-theme');
const inpAccent = document.getElementById('inp-accent');
const inpFontBody = document.getElementById('inp-font-body');
const inpFontCode = document.getElementById('inp-font-code');
const inpFontSize = document.getElementById('inp-font-size');
const snippetListEl = document.getElementById('snippet-list');
const themeVarsEl = document.getElementById('theme-vars');
const importStatusEl = document.getElementById('theme-import-status');
const shortcutListEl = document.getElementById('shortcut-list');

// Fonts that travel with the app (src/renderer/fonts): listed first.
const BUNDLED_FONTS = ['Geist', 'Geist Mono', 'Mona Sans', 'Inter', 'Inter Display', 'Satoshi'];

const FALLBACK_FONTS = [
  'Segoe UI', 'Calibri', 'Cambria', 'Georgia', 'Verdana', 'Tahoma', 'Arial',
  'Times New Roman', 'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code',
  'Consolas', 'Courier New', 'Fira Code', 'Iosevka', 'Roboto'
];

// --- tabs ---

function selectTab(name) {
  for (const tab of document.querySelectorAll('.settings-tab')) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    // Roving tabindex: the tab strip is ONE stop in the tab order, and the
    // arrow keys move within it. Four separate stops would put the panel's own
    // controls four presses away.
    tab.tabIndex = on ? 0 : -1;
  }
  for (const pane of document.querySelectorAll('.settings-pane')) {
    const on = pane.id === 'pane-' + name;
    pane.classList.toggle('is-active', on);
    pane.hidden = !on;
  }
}

function initTabs() {
  const tabs = [...document.querySelectorAll('.settings-tab')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      let next = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (e.key === 'Home') next = tabs[0];
      if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      selectTab(next.dataset.tab);
      next.focus();
    });
  }
}

// --- fonts, themes and snippets ---

async function fillFontOptions() {
  const datalist = document.getElementById('font-options');
  let systemNames = FALLBACK_FONTS;
  try {
    if (window.queryLocalFonts) {
      const fonts = await window.queryLocalFonts();
      const set = new Set(fonts.map((f) => f.family));
      if (set.size > 0) systemNames = [...set].sort((a, b) => a.localeCompare(b));
    }
  } catch {
    // no permission to list system fonts; the fixed list stands
  }
  const names = [...BUNDLED_FONTS, ...systemNames.filter((n) => !BUNDLED_FONTS.includes(n))];
  datalist.innerHTML = '';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    datalist.appendChild(opt);
  }
}

async function fillThemeSelect() {
  const themes = await window.wired.listThemes();
  selTheme.innerHTML = '';
  for (const t of themes) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === config.theme) opt.selected = true;
    selTheme.appendChild(opt);
  }
}

async function fillSnippetList() {
  const files = await window.wired.listSnippets();
  snippetListEl.innerHTML = '';
  if (files.length === 0) {
    const p = document.createElement('p');
    p.className = 'setting-hint';
    p.textContent = 'no snippet in the folder yet.';
    snippetListEl.appendChild(p);
    return;
  }
  for (const f of files) {
    const row = document.createElement('label');
    row.className = 'snippet-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = config.snippets.includes(f);
    cb.addEventListener('change', async () => {
      if (cb.checked) {
        if (!config.snippets.includes(f)) config.snippets.push(f);
      } else {
        config.snippets = config.snippets.filter((s) => s !== f);
      }
      await applySnippets();
      saveConfig();
    });
    const span = document.createElement('span');
    span.textContent = f;
    row.appendChild(cb);
    row.appendChild(span);
    snippetListEl.appendChild(row);
  }
}

function currentAccentHex() {
  if (config.accent) return config.accent;
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#4fc7bb';
}

// --- theme variable panel ---

// Grouped in the order someone actually reasons about a palette: the surfaces
// first, then the text that sits on them, then the accent, then the states.
// Anything the theme declares that is not in this map still shows up, under
// "other", so a third party theme is never silently half editable.
const GROUPS = [
  ['backgrounds', ['--bg', '--bg-2', '--bg-3']],
  ['lines', ['--rule', '--rule-soft', '--rule-row', '--leader']],
  ['ink', ['--ink', '--ink-dim', '--ink-faint']],
  ['accent', ['--accent', '--accent-soft', '--accent-ink', '--accent-dim']],
  ['states', ['--green', '--amber', '--red', '--search-hit-ink', '--warn-ink', '--schema-ink', '--win-close-ink']]
];

// The text pairings the app really renders, as [ink, surface, what it is].
// Same list the build time script asserts, trimmed to the pairs a user can
// break from this panel.
const CHECK_PAIRS = [
  ['--ink', '--bg', 'body text'],
  ['--ink', '--bg-2', 'text in panels'],
  ['--ink', '--bg-3', 'text in controls'],
  ['--ink-dim', '--bg', 'secondary text'],
  ['--ink-dim', '--bg-2', 'secondary text in panels'],
  ['--ink-dim', '--bg-3', 'secondary text in controls'],
  ['--ink-faint', '--bg', 'hints'],
  ['--ink-faint', '--bg-2', 'hints in panels'],
  ['--ink-faint', '--bg-3', 'hints in controls'],
  ['--accent', '--bg', 'links'],
  ['--accent-soft', '--bg', 'headings'],
  ['--accent-soft', '--bg-2', 'table headers'],
  ['--accent-soft', '--bg-3', 'active row, inline code'],
  ['--accent-ink', '--bg', 'small headings'],
  ['--amber', '--bg-2', 'unsaved marker'],
  ['--red', '--bg-2', 'destructive action'],
  ['--green', '--bg-2', 'positive state'],
  ['--warn-ink', '--bg-2', 'schema warning'],
  ['--schema-ink', '--bg-3', 'schema badge'],
  ['--win-close-ink', '--red', 'close button glyph']
];

const FLOOR = 4.5;
const CEILING = 11;

// The value in force for a variable right now: the override if there is one,
// otherwise what the theme declares.
function effective(vars, name) {
  const over = overridesFor();
  return over[name] || vars[name] || '';
}

function isHex(v) {
  return /^#[0-9a-f]{6}$/i.test(String(v || '').trim());
}

// Measures every pairing and returns the ones that left the band. Runs in the
// renderer off the same contrastRatio the rest of the app uses, so the panel
// and the build time gate can never disagree about what a number is.
function contrastProblems(vars) {
  const out = [];
  for (const [inkName, bgName, where] of CHECK_PAIRS) {
    const ink = hexToRgb(effective(vars, inkName));
    const bg = hexToRgb(effective(vars, bgName));
    if (!ink || !bg) continue;
    const r = contrastRatio(ink, bg);
    if (r < FLOOR) out.push({ where, inkName, bgName, ratio: r, how: 'too low' });
    else if (r > CEILING) out.push({ where, inkName, bgName, ratio: r, how: 'too high' });
  }
  return out;
}

function warnIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tvar-warn-ico');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M12 9v5M12 17.5v.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z');
  svg.appendChild(p);
  return svg;
}

function resetIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M3 3v6h6');
  const a = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  a.setAttribute('d', 'M3.5 9a9 9 0 1 1 .5 6');
  svg.appendChild(p);
  svg.appendChild(a);
  return svg;
}

// Redraws only the warning rows, which is what changes on most edits. The
// inputs keep their focus and their open color picker.
function renderWarnings() {
  const vars = themeVars();
  const problems = contrastProblems(vars);
  for (const old of themeVarsEl.querySelectorAll('.tvar-warn')) old.remove();

  for (const p of problems) {
    // The warning belongs under the ink of the pairing, which is the value the
    // user was most likely just editing.
    const row = themeVarsEl.querySelector('.tvar-row[data-name="' + p.inkName + '"]');
    if (!row) continue;
    const warn = document.createElement('div');
    warn.className = 'tvar-warn';
    warn.appendChild(warnIcon());
    const span = document.createElement('span');
    span.textContent =
      p.where + ' sits at ' + p.ratio.toFixed(2) + ':1 on ' + p.bgName + ', ' + p.how +
      (p.how === 'too low' ? ' (the floor is 4.5:1)' : ' (the ceiling is 11:1)');
    warn.appendChild(span);
    row.insertAdjacentElement('afterend', warn);
  }
}

function renderThemeVars() {
  const vars = themeVars();
  const over = overridesFor();
  themeVarsEl.innerHTML = '';

  const known = new Set(GROUPS.flatMap(([, names]) => names));
  const others = Object.keys(vars).filter((n) => !known.has(n) && isHex(vars[n]));
  const groups = others.length ? [...GROUPS, ['other', others]] : GROUPS;

  for (const [title, names] of groups) {
    // A theme is not obliged to declare every variable, and a non hex value
    // (--focus-dim, --accent-rgb) has no color picker to offer.
    const present = names.filter((n) => isHex(vars[n]) || isHex(over[n]));
    if (!present.length) continue;

    const group = document.createElement('div');
    group.className = 'tvar-group';
    const heading = document.createElement('div');
    heading.className = 'tvar-group-title';
    heading.textContent = title;
    group.appendChild(heading);

    for (const name of present) {
      const value = effective(vars, name);
      const row = document.createElement('div');
      row.className = 'tvar-row' + (over[name] ? ' is-overridden' : '');
      row.dataset.name = name;

      const input = document.createElement('input');
      input.type = 'color';
      input.value = isHex(value) ? value : '#000000';
      input.title = 'Set ' + name;
      input.setAttribute('aria-label', 'Color for ' + name);

      const label = document.createElement('span');
      label.className = 'tvar-name';
      label.textContent = name;

      const shown = document.createElement('span');
      shown.className = 'tvar-value';
      shown.textContent = value;

      const reset = document.createElement('button');
      reset.className = 'tvar-reset';
      reset.title = 'Reset ' + name + ' to the theme value';
      reset.setAttribute('aria-label', 'Reset ' + name + ' to the theme value');
      reset.appendChild(resetIcon());

      // `input` fires continuously while the picker is open: apply live so the
      // window updates under the cursor, but only write config on `change`.
      // Both paths mark the row, because `change` can arrive WITHOUT a
      // preceding `input` (a picker dismissed with a new value, and every
      // programmatic set the E2E makes).
      const commit = (persist) => {
        setOverride(name, input.value);
        shown.textContent = input.value;
        row.classList.add('is-overridden');
        applyCustom();
        renderWarnings();
        if (persist) saveConfig();
      };
      input.addEventListener('input', () => commit(false));
      input.addEventListener('change', () => commit(true));

      reset.addEventListener('click', () => {
        clearOverride(name);
        applyCustom();
        renderThemeVars();
        saveConfig();
      });

      row.appendChild(input);
      row.appendChild(label);
      row.appendChild(shown);
      row.appendChild(reset);
      group.appendChild(row);
    }
    themeVarsEl.appendChild(group);
  }

  if (!themeVarsEl.children.length) {
    const p = document.createElement('p');
    p.className = 'setting-hint';
    p.textContent = 'this theme declares no color variables this panel can edit.';
    themeVarsEl.appendChild(p);
  }

  renderWarnings();
}

// --- shortcuts (read only) ---

const SHORTCUTS = [
  ['files', [
    ['Ctrl+O', 'Open a file'],
    ['Ctrl+N', 'New file'],
    ['Ctrl+S', 'Save'],
    ['Ctrl+Shift+S', 'Save as']
  ]],
  ['navigation', [
    ['Ctrl+P', 'Quick switcher'],
    ['Ctrl+Shift+P', 'Command palette'],
    ['Ctrl+Shift+F', 'Search the folder contents'],
    ['Esc', 'Close the overlay in front']
  ]],
  ['writing', [
    ['F8', 'Focus mode'],
    ['F9', 'Typewriter mode'],
    ['Ctrl+=', 'Larger text'],
    ['Ctrl+-', 'Smaller text'],
    ['Ctrl+0', 'Text back to 15px']
  ]],
  ['tools', [
    ['Ctrl+`', 'Terminal']
  ]]
];

function fillShortcuts() {
  if (!shortcutListEl || shortcutListEl.children.length) return;
  for (const [group, rows] of SHORTCUTS) {
    const h = document.createElement('div');
    h.className = 'shortcut-group';
    h.textContent = group;
    shortcutListEl.appendChild(h);
    for (const [keys, what] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = keys;
      const dd = document.createElement('dd');
      dd.textContent = what;
      shortcutListEl.appendChild(dt);
      shortcutListEl.appendChild(dd);
    }
  }
}

// --- open, close, and the panel lifecycle ---

export async function openSettings() {
  await Promise.all([fillThemeSelect(), fillSnippetList(), fillFontOptions()]);
  inpAccent.value = currentAccentHex();
  inpFontBody.value = config.fontBody || '';
  inpFontCode.value = config.fontCode || '';
  inpFontSize.value = config.fontSize || 15;
  importStatusEl.textContent = '';
  fillShortcuts();
  renderThemeVars();
  settingsOverlay.classList.remove('hidden');
}

export function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

export function isSettingsOpen() {
  return !settingsOverlay.classList.contains('hidden');
}

// The font size field mirrors the zoom shortcuts while the panel is open.
export function reflectFontSize(size) {
  if (isSettingsOpen()) inpFontSize.value = size;
}

export function initSettings() {
  document.getElementById('btn-config').addEventListener('click', () => openSettings());
  document.getElementById('btn-settings-close').addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  initTabs();

  selTheme.addEventListener('change', async () => {
    config.theme = selTheme.value;
    await applyTheme(config.theme);
    inpAccent.value = currentAccentHex();
    // A different theme means a different override set and different variables,
    // so the panel is rebuilt rather than patched.
    renderThemeVars();
    saveConfig();
  });

  inpAccent.addEventListener('input', () => {
    config.accent = inpAccent.value;
    applyCustom();
  });
  inpAccent.addEventListener('change', () => saveConfig());

  document.getElementById('btn-accent-reset').addEventListener('click', () => {
    config.accent = null;
    applyCustom();
    inpAccent.value = currentAccentHex();
    saveConfig();
  });

  document.getElementById('btn-vars-reset-all').addEventListener('click', () => {
    clearAllOverrides();
    applyCustom();
    renderThemeVars();
    saveConfig();
  });

  document.getElementById('btn-import-theme').addEventListener('click', async () => {
    const res = await window.wired.importTheme();
    if (!res || res.canceled) return;
    if (!res.ok) {
      importStatusEl.textContent = 'could not import: ' + (res.error || 'unknown reason');
      return;
    }
    await fillThemeSelect();
    importStatusEl.textContent = 'imported "' + res.name + '". Pick it above to try it.';
  });

  const bindTextSetting = (input, key) => {
    input.addEventListener('change', () => {
      config[key] = input.value.trim();
      applyCustom();
      saveConfig();
    });
  };
  bindTextSetting(inpFontBody, 'fontBody');
  bindTextSetting(inpFontCode, 'fontCode');

  inpFontSize.addEventListener('change', () => {
    const v = Number(inpFontSize.value);
    if (v >= 11 && v <= 26) {
      config.fontSize = v;
      applyCustom();
      saveConfig();
    }
  });

  document.getElementById('btn-open-snippets').addEventListener('click', () => window.wired.openSnippetsFolder());
  document.getElementById('btn-open-themes').addEventListener('click', () => window.wired.openThemesFolder());
  document.getElementById('btn-reload-snippets').addEventListener('click', async () => {
    await fillSnippetList();
    await applySnippets();
  });
}

// The E2E drives the variable panel through these.
export { renderThemeVars, selectTab };
