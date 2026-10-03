// Errors that are not about one pane (a file operation in the tree, a template
// that could not be written) used to be alert() boxes: modal, blocking the
// typing, and a frozen window for the E2E suite. They are a quiet note in the
// corner now, in the same warning ink as the inline rows, that goes away on
// its own or on a click. Decisions (delete this? close unsaved?) still ask.
import { svgIcon, ICON_ALERT } from './icons.js';

const host = document.createElement('div');
host.id = 'toasts';
host.setAttribute('role', 'status');
host.setAttribute('aria-live', 'polite');
document.body.appendChild(host);

const SHOW_MS = 7000;

export function notify(message) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.title = 'Click to dismiss';
  const ico = svgIcon(13, ICON_ALERT);
  ico.classList.add('toast-ico');
  const txt = document.createElement('span');
  txt.textContent = message;
  t.appendChild(ico);
  t.appendChild(txt);
  const drop = () => t.remove();
  t.addEventListener('click', drop);
  host.appendChild(t);
  // A burst of failures stays readable: the oldest go first.
  while (host.children.length > 4) host.firstChild.remove();
  setTimeout(drop, SHOW_MS);
  return t;
}

window.wiredNotify = notify;
