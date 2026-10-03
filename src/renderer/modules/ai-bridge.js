// AI bridge, per note.
//
// It opens the terminal, cds the shell into the note's folder, brings up the AI
// CLI session there and types the quoted path with NO trailing Enter, leaving the cursor
// there so the owner finishes the prompt. This never sends on its own: spending
// a token is the owner's call. No API, no key, no background request.
//
// The CLI is a CONFIG KEY (`aiCliCommand`, "claude" by default), because the
// editor is for people who write markdown for AI and the AI they use is theirs
// to pick. Whatever the command is, the rule above does not move: the bridge
// never presses Enter on the final prompt line.

import { config, registerConfigDefaults, activePane, dirName, sleep } from './state.js';
import { toggleTerminal, termType, termTypeRaw, getTermBuffer, isTerminalRunning, focusTerminal } from './terminal.js';
import { setActivePane } from './panes.js';

import { onThemeApplied } from './theme.js';
import { notify } from './toast.js';

registerConfigDefaults({ aiCliCommand: 'claude' });

// The command as configured, with the shipped default as the floor: an empty
// string in config.json must never turn into typing nothing into a shell.
export function aiCliCommand() {
  const raw = typeof config.aiCliCommand === 'string' ? config.aiCliCommand.trim() : '';
  return raw || 'claude';
}

// The chrome says which CLI it will bring up, so the sparkles button is never a
// mystery after the key is changed. It rides on the theme hook, which is the
// existing "the config was applied, refresh the chrome" moment: no new hook and
// no edit in the modules that own those buttons.
export function applyAiCliLabels() {
  const cmd = aiCliCommand();
  for (const btn of document.querySelectorAll('.pane-claude')) {
    btn.title = 'Send this note to ' + cmd;
    btn.setAttribute('aria-label', 'Send this note to ' + cmd);
  }
  const termBtn = document.getElementById('btn-claude');
  if (termBtn) {
    termBtn.textContent = cmd;
    termBtn.title = 'Type the ' + cmd + ' command into the shell';
    termBtn.setAttribute('aria-label', 'Type the ' + cmd + ' command into the shell');
  }
}

onThemeApplied(applyAiCliLabels);

// A pane opened later is born with the label the module that draws it wrote.
// Watching for it here keeps the naming in one file instead of teaching panes.js
// about the config key.
const panesHost = document.getElementById('panes');
if (panesHost) {
  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType === 1 && node.querySelector && node.querySelector('.pane-claude')) {
          applyAiCliLabels();
          return;
        }
      }
    }
  }).observe(panesHost, { childList: true });
}

// Waits for the AI session to come up: the buffer grows with the TUI and then
// settles (minimum 2s, ceiling 15s; polling, because the time varies a lot per
// machine and per CLI).
async function waitCliReady() {
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
    notify('No file open to send to ' + aiCliCommand() + '.');
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
    // The CLI starts in the note's folder through a plain shell cd before it,
    // which works for whichever CLI is configured. A slash command typed
    // inside the CLI would only ever mean something to one of them.
    termType('cd "' + dirName(notePath) + '"');
    await sleep(300);
    termType(aiCliCommand());
    await waitCliReady();
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
    notify('No text selected to send to ' + aiCliCommand() + '.');
    return;
  }
  const compact = text.replace(/\s+/g, ' ').slice(0, 2000);
  const pane = activePane();
  claudeBridge(pane ? pane.path : null, compact);
}
