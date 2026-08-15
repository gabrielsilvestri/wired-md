// Custom title bar of the frameless window: icon buttons, the centered file
// name and the window controls. No text menus anywhere: every action is an icon
// with a tooltip, or a shortcut, or the command palette.

import { activePane, baseName } from './state.js';

const titlebarTitle = document.getElementById('titlebar-title');
const winMaxBtn = document.getElementById('win-max');

// The product name has ONE source: the app name Electron reads out of
// package.json. Nothing in the renderer spells it out again, so renaming the
// product is a single edit.
export const APP_NAME = window.wired.appName || 'wired-md';

export function updateChrome() {
  const p = activePane();
  const isDirty = !!(p && p.dirty);
  // With no file open the bar carries the product name, not the word "no file":
  // an empty editor is the app at rest, not an error.
  const named = !!(p && p.path);
  const name = named ? baseName(p.path) : APP_NAME;
  titlebarTitle.textContent = (isDirty ? '● ' : '') + name;
  titlebarTitle.title = (p && p.path) || APP_NAME;
  titlebarTitle.classList.toggle('dirty', isDirty);
  titlebarTitle.classList.toggle('is-product', !named);
  window.wired.setTitle(named ? (isDirty ? '● ' : '') + name + ' | ' + APP_NAME : APP_NAME);
}

function setMaxState(isMax) {
  winMaxBtn.classList.toggle('is-max', isMax);
  winMaxBtn.title = isMax ? 'Restore' : 'Maximize';
}

export function initTitlebar() {
  document.getElementById('win-min').addEventListener('click', () => window.wired.winMinimize());
  winMaxBtn.addEventListener('click', () => window.wired.winMaximizeToggle());
  document.getElementById('win-close').addEventListener('click', () => window.wired.winClose());
  window.wired.onMaximized((v) => setMaxState(v));
  window.wired.winIsMaximized().then(setMaxState);

  // Double click on the drag region maximizes or restores, like Windows does.
  document.getElementById('titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('button, .menu-root, #titlebar-controls')) return;
    window.wired.winMaximizeToggle();
  });
}
