// Custom title bar of the frameless window: icon buttons, the centered file
// name and the window controls. No text menus anywhere: every action is an icon
// with a tooltip, or a shortcut, or the command palette.

import { activePane, baseName } from './state.js';

const titlebarTitle = document.getElementById('titlebar-title');
const winMaxBtn = document.getElementById('win-max');

export function updateChrome() {
  const p = activePane();
  const isDirty = !!(p && p.dirty);
  const name = p && p.path ? baseName(p.path) : 'no file';
  titlebarTitle.textContent = (isDirty ? '● ' : '') + name;
  titlebarTitle.title = (p && p.path) || '';
  titlebarTitle.classList.toggle('dirty', isDirty);
  window.wired.setTitle((isDirty ? '● ' : '') + name + ' | wired-md');
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
