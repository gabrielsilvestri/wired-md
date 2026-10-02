// Unsaved edits that survive a crash. Every couple of seconds each tab with
// unsaved changes leaves a snapshot of its text in the main process
// (src/main/ipc/recovery.js); a tab that is clean again, or gone, takes its
// snapshot away. A snapshot found at launch is work the last session never
// saved, and it comes back as an unsaved tab with an inline note saying so.
//
// Closing the window settles this first (modules/close-guard.js): "don't save"
// throws the snapshots away on purpose, so discarded edits never come back.
import { panes } from './state.js';
import { openPath, newFile, setPaneDirty } from './panes.js';
import { paneStatus } from './links.js';

const TICK_MS = 2000;
const SESSION = Date.now().toString(36);
const written = new Map(); // key -> the text last snapshotted under it

function keyOf(pane) {
  return pane.path ? 'file:' + pane.path.toLowerCase() : 'untitled:' + SESSION + ':' + pane.id;
}

let running = false;
export async function snapshotNow() {
  if (running) return;
  running = true;
  try {
    const live = new Set();
    for (const pane of panes) {
      if (!pane.ready || !pane.vditor) continue;
      const key = keyOf(pane);
      // Save As turns an untitled key into a file key: the old one goes.
      if (pane.recoveryKey && pane.recoveryKey !== key && written.has(pane.recoveryKey)) {
        written.delete(pane.recoveryKey);
        await window.wired.recoveryDrop(pane.recoveryKey);
      }
      pane.recoveryKey = key;
      if (!pane.dirty) continue;
      live.add(key);
      let text = '';
      try {
        text = pane.vditor.getValue();
      } catch {
        continue;
      }
      if (written.get(key) === text) continue;
      written.set(key, text);
      await window.wired.recoverySave(key, { path: pane.path, content: text });
    }
    for (const key of [...written.keys()]) {
      if (live.has(key)) continue;
      written.delete(key);
      await window.wired.recoveryDrop(key);
    }
  } finally {
    running = false;
  }
}

// Called by the close guard. `discard` is the user saying "don't save": every
// snapshot goes. Otherwise one last pass keeps exactly the unsaved ones.
export async function settleRecovery(discard) {
  if (!discard) return snapshotNow();
  const keys = new Set([...written.keys(), ...panes.map((p) => p.recoveryKey).filter(Boolean)]);
  written.clear();
  for (const key of keys) await window.wired.recoveryDrop(key);
}

function whenReady(pane) {
  return new Promise((resolve) => {
    const started = Date.now();
    const t = setInterval(() => {
      if (pane.ready || Date.now() - started > 8000) {
        clearInterval(t);
        resolve(!!pane.ready);
      }
    }, 25);
  });
}

// Launch: every snapshot left behind becomes an unsaved tab again.
export async function restoreRecovery() {
  const entries = (await window.wired.recoveryList()) || [];
  let restored = 0;
  for (const e of entries) {
    let pane = null;
    let note = 'Recovered unsaved edits from the last session. Save to keep them.';
    if (e.path && (await window.wired.readFile(e.path)).ok) {
      await openPath(e.path);
      pane = panes.find((p) => p.path === e.path) || null;
    } else {
      pane = newFile();
      if (pane && !(await whenReady(pane))) pane = null;
      if (e.path) note = 'Recovered unsaved edits of ' + e.path + ', which is no longer on disk. Save to keep them.';
    }
    if (pane && pane.vditor.getValue() !== e.content) {
      pane.vditor.setValue(e.content);
      setPaneDirty(pane, true);
      paneStatus(pane, note);
      restored += 1;
    }
    await window.wired.recoveryDrop(e.key);
  }
  if (restored) await snapshotNow();
  return restored;
}

setInterval(() => void snapshotNow(), TICK_MS);

window.wiredRecovery = { snapshotNow, settleRecovery, restoreRecovery };
