// AI bridge, per note.
//
// It opens the terminal, brings up a claude session, runs /cd into the note's
// folder and types the quoted path with NO trailing Enter, leaving the cursor
// there so the owner finishes the prompt. This never sends on its own: spending
// a token is the owner's call. No API, no key, no background request.

import { activePane, dirName, sleep } from './state.js';
import { toggleTerminal, termType, termTypeRaw, getTermBuffer, isTerminalRunning, focusTerminal } from './terminal.js';
import { setActivePane } from './panes.js';

// Waits for the claude session to come up: the buffer grows with the TUI and
// then settles (minimum 2s, ceiling 15s; polling, because the time varies a lot
// per machine).
async function waitClaudeReady() {
  const start = Date.now();
  let last = getTermBuffer();
  let stableSince = Date.now();
  while (Date.now() - start < 15000) {
    await sleep(300);
    const buf = getTermBuffer();
    if (buf !== last) {
      last = buf;
      stableSince = Date.now();
    }
    if (Date.now() - start >= 2000 && Date.now() - stableSince >= 900 && buf !== '') return;
  }
}

let bridgeBusy = false;

export async function claudeBridge(notePath, selection) {
  if (!notePath) {
    alert('No file open to send to claude.');
    return;
  }
  if (bridgeBusy) return;
  bridgeBusy = true;
  try {
    toggleTerminal(true);
    const t0 = Date.now();
    while (!isTerminalRunning() && Date.now() - t0 < 8000) await sleep(200);
    if (!isTerminalRunning()) return;
    await sleep(400);
    termType('claude');
    await waitClaudeReady();
    termType('/cd ' + dirName(notePath));
    await sleep(600);
    let text = '"' + notePath + '" ';
    if (selection) text += 'about this snippet: "' + selection + '" ';
    // NEVER with Enter. This is the whole point of the bridge.
    termTypeRaw(text);
    focusTerminal();
  } finally {
    bridgeBusy = false;
  }
}

export function sendPaneToClaude(pane) {
  setActivePane(pane);
  claudeBridge(pane ? pane.path : null, '');
}

export function sendFileToClaude() {
  const pane = activePane();
  claudeBridge(pane ? pane.path : null, '');
}

// Selection captured when the palette opens (focusing the input can drop the
// editor selection).
let lastSelection = '';

export function setLastSelection(text) {
  lastSelection = text || '';
}

function currentSelectionText() {
  const sel = window.getSelection ? String(window.getSelection()) : '';
  return (sel || lastSelection || '').trim();
}

export function sendSelectionToClaude() {
  const text = currentSelectionText();
  if (!text) {
    alert('No text selected to send to claude.');
    return;
  }
  const compact = text.replace(/\s+/g, ' ').slice(0, 2000);
  const pane = activePane();
  claudeBridge(pane ? pane.path : null, compact);
}
