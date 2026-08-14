// Themes, accent derivation, fonts and CSS snippets, plus the color math.
//
// The 4.5:1 contrast floor for text is a hard rule in this app, so the focus
// mode opacity is MEASURED against the active theme, never guessed.

import { config, registerConfigDefaults } from './state.js';

registerConfigDefaults({ theme: 'wired', accent: null, fontBody: '', fontCode: '', fontSize: 15, snippets: [] });

const themeStyle = document.getElementById('theme-style');
const customStyle = document.getElementById('custom-style');

// Hooks other modules attach to so a theme change can reach them without this
// module importing the terminal, the panes and everything else.
const afterApply = [];

export function onThemeApplied(fn) {
  afterApply.push(fn);
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

// Derives the accent variants from a single color, in the spirit of the original
// palette (soft lighter, ink slightly darker, dim much darker).
export function accentCss(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const soft = rgbToHex(mix(rgb, [255, 255, 255], 0.28));
  const ink = rgbToHex(mix(rgb, [0, 0, 0], 0.08));
  const dim = rgbToHex(mix(rgb, [0, 0, 0], 0.32));
  return [
    '--accent:' + hex + ';',
    '--accent-soft:' + soft + ';',
    '--accent-ink:' + ink + ';',
    '--accent-dim:' + dim + ';',
    '--accent-rgb:' + rgb.map(Math.round).join(',') + ';'
  ].join('');
}

export function relLuminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a, b) {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The lowest opacity that still keeps dimmed text at 4.6:1 (one notch above the
// floor) against the background of the ACTIVE theme. In wired that is 0.62
// (4.66:1); in the light theme, which loses contrast much faster, it is 0.76
// (also 4.66:1). A third party theme goes through the same math. A color that
// cannot be read as hex returns null and the theme's own value stands.
export function focusDimFor(bgHex, inkHex) {
  const bg = hexToRgb(bgHex || '');
  const ink = hexToRgb(inkHex || '');
  if (!bg || !ink) return null;
  for (let a = 0.4; a <= 0.95; a += 0.01) {
    const composed = ink.map((v, i) => bg[i] + (v - bg[i]) * a);
    if (contrastRatio(bg, composed) >= 4.6) return Math.round(a * 100) / 100;
  }
  return 0.95;
}

function cssFontValue(name) {
  const clean = name.trim().replace(/["';{}]/g, '');
  return clean ? '"' + clean + '",' : '';
}

// Rebuilds the user override <style> from the config.
export function applyCustom() {
  let vars = '';
  if (config.accent) vars += accentCss(config.accent);
  if (config.fontBody) vars += '--font-body:' + cssFontValue(config.fontBody) + 'var(--font-body-default);';
  if (config.fontCode) vars += '--font-code:' + cssFontValue(config.fontCode) + 'var(--font-code-default);';
  if (config.fontSize) vars += '--font-size-body:' + Number(config.fontSize) + 'px;';
  // The focus mode opacity is recomputed on every theme change so dimmed text
  // never drops below 4.5:1 in any theme (including themes already seeded in
  // %APPDATA% by an older install, which do not declare the variable).
  const cs = getComputedStyle(document.documentElement);
  const dim = focusDimFor(cs.getPropertyValue('--bg').trim(), cs.getPropertyValue('--ink').trim());
  if (dim !== null) vars += '--focus-dim:' + dim + ';';
  customStyle.textContent = vars ? ':root{' + vars + '}' : '';
  for (const fn of afterApply) fn();
}

export async function applyTheme(name) {
  const res = await window.wired.readTheme(name);
  themeStyle.textContent = res.ok ? res.css : '';
  applyCustom();
}

let snippetStyles = [];

export async function applySnippets() {
  for (const el of snippetStyles) el.remove();
  snippetStyles = [];
  for (const file of config.snippets) {
    const res = await window.wired.readSnippet(file);
    if (!res.ok) continue;
    const el = document.createElement('style');
    el.dataset.snippet = file;
    el.textContent = res.css;
    document.head.appendChild(el);
    snippetStyles.push(el);
  }
}
