// Closing the window with unsaved tabs. The main process holds the close and
// asks here; with nothing unsaved the window just closes, otherwise the user
// picks save all, don't save or cancel. "Save all" goes through the normal save
// (so the disk conflict guard still applies, and an untitled tab asks for a
// name), and the window only closes when every tab really came out clean.
import { panes, baseName } from './state.js';
import { setActivePane, save, saveAs } from './panes.js';

async function saveAllDirty() {
  for (const pane of panes.filter((p) => p.dirty)) {
    setActivePane(pane);
    if (pane.path) await save();
    else await saveAs();
    if (pane.dirty) return false; // cancelled Save As, a disk conflict, a failed write
  }
  return true;
}

// `ask` is the dialog; the E2E passes its own answer instead of a native box.
export async function handleCloseRequest(ask = (names) => window.wired.askUnsaved(names)) {
  const dirty = panes.filter((p) => p.dirty);
  if (!dirty.length) {
    window.wired.confirmClose();
    return 'closed';
  }
  const answer = await ask(dirty.map((p) => (p.path ? baseName(p.path) : 'untitled')));
  if (answer === 'discard') {
    window.wired.confirmClose();
    return 'closed';
  }
  if (answer === 'save' && (await saveAllDirty())) {
    window.wired.confirmClose();
    return 'closed';
  }
  return 'kept';
}

window.wired.onCloseRequest(() => {
  window.wired.ackClose(); // alive: main waits for the answer instead of closing
  void handleCloseRequest();
});

window.wiredCloseGuard = { handleCloseRequest };
