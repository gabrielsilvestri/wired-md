// Settings panel (the gear in the sidebar footer): theme, accent, fonts, text
// size and the CSS snippets you toggle on and off.

import { config, saveConfig } from './state.js';
import { applyTheme, applyCustom, applySnippets } from './theme.js';

const settingsOverlay = document.getElementById('settings-overlay');
const selTheme = document.getElementById('sel-theme');
const inpAccent = document.getElementById('inp-accent');
const inpFontBody = document.getElementById('inp-font-body');
const inpFontCode = document.getElementById('inp-font-code');
const inpFontSize = document.getElementById('inp-font-size');
const snippetListEl = document.getElementById('snippet-list');

// Fonts that travel with the app (src/renderer/fonts): listed first.
const BUNDLED_FONTS = ['Geist', 'Geist Mono', 'Mona Sans', 'Inter', 'Inter Display', 'Satoshi'];

const FALLBACK_FONTS = [
  'Segoe UI', 'Calibri', 'Cambria', 'Georgia', 'Verdana', 'Tahoma', 'Arial',
  'Times New Roman', 'JetBrains Mono', 'Cascadia Mono', 'Cascadia Code',
  'Consolas', 'Courier New', 'Fira Code', 'Iosevka', 'Roboto'
];

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

export async function openSettings() {
  await Promise.all([fillThemeSelect(), fillSnippetList(), fillFontOptions()]);
  inpAccent.value = currentAccentHex();
  inpFontBody.value = config.fontBody || '';
  inpFontCode.value = config.fontCode || '';
  inpFontSize.value = config.fontSize || 15;
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

  selTheme.addEventListener('change', async () => {
    config.theme = selTheme.value;
    await applyTheme(config.theme);
    inpAccent.value = currentAccentHex();
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
