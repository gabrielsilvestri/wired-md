// The document column, as settings: line height and text width.
//
// Both land as CSS variables on :root (--doc-line-height, --doc-max-width),
// which `.vditor-reset` in styles.css reads with the old fixed values as
// fallbacks. They are written inline on <html> rather than into #custom-style,
// so this module never has to edit the theme pipeline; nothing else sets them.
//
// textWidth is the max width of the column in px (the same box the old fixed
// 860px sized, padding included), or 'full' for the whole pane.

import { config, registerConfigDefaults, saveConfig } from './state.js';
import { onThemeApplied } from './theme.js';

export const LINE_HEIGHT = { min: 1.4, max: 2, step: 0.05, def: 1.65 };
export const TEXT_WIDTH = { min: 560, max: 1200, step: 20, def: 860 };

registerConfigDefaults({ lineHeight: LINE_HEIGHT.def, textWidth: TEXT_WIDTH.def });

const inpLine = document.getElementById('inp-line-height');
const outLine = document.getElementById('out-line-height');
const inpWidth = document.getElementById('inp-text-width');
const outWidth = document.getElementById('out-text-width');
const chkFull = document.getElementById('chk-text-width-full');

function clamp(v, { min, max, def }) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
}

// A value a hand edited config.json may carry, folded into the valid range.
export function lineHeightValue() {
  return Math.round(clamp(config.lineHeight, LINE_HEIGHT) * 100) / 100;
}

export function textWidthValue() {
  return config.textWidth === 'full' ? 'full' : Math.round(clamp(config.textWidth, TEXT_WIDTH));
}

function reflect() {
  const lh = lineHeightValue();
  const tw = textWidthValue();
  inpLine.value = String(lh);
  outLine.textContent = lh.toFixed(2);
  chkFull.checked = tw === 'full';
  inpWidth.disabled = tw === 'full';
  if (tw !== 'full') inpWidth.value = String(tw);
  outWidth.textContent = tw === 'full' ? 'full' : tw + 'px';
}

export function applyReading() {
  const root = document.documentElement.style;
  root.setProperty('--doc-line-height', String(lineHeightValue()));
  const tw = textWidthValue();
  root.setProperty('--doc-max-width', tw === 'full' ? 'none' : tw + 'px');
  reflect();
}

export function initReading() {
  // `input` while dragging applies live; `change` on release persists.
  inpLine.addEventListener('input', () => {
    config.lineHeight = Number(inpLine.value);
    applyReading();
  });
  inpLine.addEventListener('change', () => saveConfig());

  inpWidth.addEventListener('input', () => {
    config.textWidth = Number(inpWidth.value);
    applyReading();
  });
  inpWidth.addEventListener('change', () => saveConfig());

  chkFull.addEventListener('change', () => {
    config.textWidth = chkFull.checked ? 'full' : Number(inpWidth.value) || TEXT_WIDTH.def;
    applyReading();
    saveConfig();
  });

  document.getElementById('btn-reading-reset').addEventListener('click', () => {
    config.lineHeight = LINE_HEIGHT.def;
    config.textWidth = TEXT_WIDTH.def;
    applyReading();
    saveConfig();
  });

  // Every applyCustom (boot included, right after the config loads) reapplies,
  // so the column never shows the defaults over a saved preference.
  onThemeApplied(applyReading);
  applyReading();
}
