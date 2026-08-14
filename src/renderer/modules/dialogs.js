// The app's own input dialog (new file, new folder, rename, template question).
// prompt() does not exist in Electron, so this is a small overlay in the theme
// palette, and it resolves a promise like prompt() would.

const inputOverlay = document.getElementById('input-overlay');
const inputTitle = document.getElementById('input-title');
const inputField = document.getElementById('input-field');
const inputOk = document.getElementById('input-ok');
const inputCancel = document.getElementById('input-cancel');

let inputResolve = null;

export function askInput(title, value, okLabel) {
  return new Promise((resolve) => {
    inputResolve = resolve;
    inputTitle.textContent = title;
    inputOk.textContent = okLabel || 'ok';
    inputField.value = value || '';
    inputOverlay.classList.remove('hidden');
    inputField.focus();
    // Preselects the name without the extension, the way Explorer does on rename.
    const dot = inputField.value.lastIndexOf('.');
    inputField.setSelectionRange(0, dot > 0 ? dot : inputField.value.length);
  });
}

export function closeInput(result) {
  inputOverlay.classList.add('hidden');
  const r = inputResolve;
  inputResolve = null;
  if (r) r(result);
}

inputOk.addEventListener('click', () => closeInput(inputField.value.trim() || null));
inputCancel.addEventListener('click', () => closeInput(null));
inputOverlay.addEventListener('mousedown', (e) => {
  if (e.target === inputOverlay) closeInput(null);
});
inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    closeInput(inputField.value.trim() || null);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeInput(null);
  }
  e.stopPropagation();
});
