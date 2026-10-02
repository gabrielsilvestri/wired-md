// Theme gallery: the catalog of themes that ships inside the app
// (themes/catalog), browsed from the Appearance settings.
//
// Nothing here talks to a network. A card is a small rendered page built from
// the theme's OWN variables (they are scoped to the card, so the preview never
// leaks into the app), and installing copies the file into the user's themes
// folder. Main refuses to overwrite a file that is already there; the card then
// just reads "installed", because a same named file may be one the user edited.

import { config } from './state.js';
import { registerPaletteAction } from './palette.js';
import { openSettings, isSettingsOpen, selectTab, fillThemeSelect } from './settings.js';

const overlay = document.getElementById('settings-overlay');
const panel = document.getElementById('settings-panel');
const galleryPane = document.getElementById('pane-gallery');
const gridEl = document.getElementById('gallery-grid');
const statusEl = document.getElementById('gallery-status');
const selTheme = document.getElementById('sel-theme');

// Only the variables the preview paints with cross into the card.
const PREVIEW_VARS = ['--bg', '--bg-2', '--bg-3', '--rule-soft', '--ink', '--ink-dim', '--accent', '--accent-soft', '--accent-dim'];

export function isGalleryOpen() {
  return !galleryPane.hidden;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function previewOf(theme) {
  const p = el('div', 'gallery-preview');
  p.setAttribute('aria-hidden', 'true');
  for (const name of PREVIEW_VARS) {
    if (theme.vars[name]) p.style.setProperty('--gp' + name.slice(1), theme.vars[name]);
  }
  p.appendChild(el('div', 'gp-h', 'Field notes'));
  const para = el('div', 'gp-p');
  para.append('Plain text, a ', el('span', 'gp-a', 'link'), ' and ', el('span', 'gp-ic', 'code'), '.');
  p.appendChild(para);
  p.appendChild(el('div', 'gp-q', 'A quoted line, dimmer.'));
  const code = el('div', 'gp-code');
  code.append(el('span', 'gp-kw', 'const'), ' wired = ', el('span', 'gp-str', "'md'"), ';');
  p.appendChild(code);
  return p;
}

function cardOf(theme) {
  const card = el('div', 'gallery-card');
  card.dataset.theme = theme.name;
  if (theme.about) card.title = theme.about;
  card.appendChild(previewOf(theme));

  const meta = el('div', 'gallery-meta');
  const names = el('div', 'gallery-names');
  names.appendChild(el('span', 'gallery-name', theme.name));
  names.appendChild(el('span', 'gallery-kind', theme.dark ? 'dark' : 'light'));
  meta.appendChild(names);

  const actions = el('div', 'gallery-actions');
  if (config.theme === theme.name) {
    actions.appendChild(el('span', 'gallery-state is-current', 'in use'));
  } else if (theme.installed) {
    actions.appendChild(el('span', 'gallery-state', 'installed'));
    const use = el('button', 'gallery-btn gallery-use', 'use');
    use.title = 'Switch to ' + theme.name;
    use.setAttribute('aria-label', 'Use the ' + theme.name + ' theme');
    use.addEventListener('click', () => useTheme(theme.name));
    actions.appendChild(use);
  } else {
    const install = el('button', 'gallery-btn gallery-install', 'install');
    install.title = 'Copy ' + theme.name + ' into your themes folder';
    install.setAttribute('aria-label', 'Install the ' + theme.name + ' theme');
    install.addEventListener('click', () => installTheme(theme.name));
    actions.appendChild(install);
  }
  meta.appendChild(actions);
  card.appendChild(meta);
  return card;
}

export async function renderGallery() {
  let themes = [];
  try {
    themes = await window.wired.listCatalogThemes();
  } catch {}
  gridEl.innerHTML = '';
  if (!themes.length) {
    gridEl.appendChild(el('p', 'setting-hint', 'the catalog is empty in this build.'));
    return;
  }
  // Dark first, then light, each alphabetical: the two kinds read as two shelves.
  themes.sort((a, b) => (a.dark === b.dark ? a.name.localeCompare(b.name) : a.dark ? -1 : 1));
  for (const t of themes) gridEl.appendChild(cardOf(t));
}

async function installTheme(name) {
  const res = await window.wired.installCatalogTheme(name);
  if (!res || !res.ok) {
    statusEl.textContent = 'could not install ' + name + ': ' + ((res && res.error) || 'unknown reason');
    return;
  }
  statusEl.textContent = res.already
    ? name + ' was already in your themes folder; it was left as it is.'
    : name + ' installed. Use it from its card or from the theme selector.';
  await fillThemeSelect();
  await renderGallery();
}

// Goes through the selector's own change handler, so a theme picked here is
// applied, measured and saved exactly like one picked in the dropdown.
async function useTheme(name) {
  await fillThemeSelect();
  if (![...selTheme.options].some((o) => o.value === name)) {
    statusEl.textContent = name + ' is not in your themes folder anymore.';
    await renderGallery();
    return;
  }
  selTheme.value = name;
  selTheme.dispatchEvent(new Event('change'));
  statusEl.textContent = 'now using ' + name + '.';
  await renderGallery();
}

export async function openGallery() {
  if (!isSettingsOpen()) await openSettings();
  for (const pane of document.querySelectorAll('.settings-pane')) {
    const on = pane === galleryPane;
    pane.classList.toggle('is-active', on);
    pane.hidden = !on;
  }
  panel.classList.add('is-wide');
  statusEl.textContent = '';
  await renderGallery();
  document.getElementById('btn-gallery-back').focus();
}

export function closeGallery() {
  panel.classList.remove('is-wide');
  selectTab('appearance');
}

export function initGallery() {
  document.getElementById('btn-theme-gallery').addEventListener('click', () => openGallery());
  document.getElementById('btn-gallery-back').addEventListener('click', () => {
    closeGallery();
    document.getElementById('btn-theme-gallery').focus();
  });
  // Any tab click leaves the gallery; the panel goes back to its usual width.
  for (const tab of document.querySelectorAll('.settings-tab')) {
    tab.addEventListener('click', () => panel.classList.remove('is-wide'));
  }
  // Closing settings from inside the gallery reopens on Appearance next time.
  new MutationObserver(() => {
    if (overlay.classList.contains('hidden') && isGalleryOpen()) closeGallery();
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
}

// Esc inside the gallery steps back to Appearance instead of closing the whole
// panel. Registered at module evaluation, which runs before the body of app.js
// adds its own global Escape handler, so stopping it here is enough.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || !isGalleryOpen() || !isSettingsOpen()) return;
    if (!document.getElementById('palette-overlay').classList.contains('hidden')) return;
    e.stopImmediatePropagation();
    closeGallery();
    document.getElementById('btn-theme-gallery').focus();
  },
  true
);

registerPaletteAction({ label: 'browse themes', run: () => openGallery() });
