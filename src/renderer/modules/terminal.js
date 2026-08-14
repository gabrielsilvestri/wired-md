// Embedded terminal (xterm.js), opened with Ctrl+`.
//
// It starts in the folder of the active note, is resizable by dragging its top
// edge (the height persists), and works with either backend: a real pty, or the
// pipe fallback where this side does the local echo and line editing.

import { config, saveConfig, registerConfigDefaults, activePane, dirName } from './state.js';
import { cssVar, onThemeApplied } from './theme.js';

registerConfigDefaults({ terminalHeight: 260 });

const terminalPanel = document.getElementById('terminal-panel');
const terminalHost = document.getElementById('terminal-host');
const terminalCwd = document.getElementById('terminal-cwd');
const terminalResizer = document.getElementById('terminal-resizer');

let xterm = null;
let fitAddon = null;
let termKind = null; // 'pty' | 'pipe' | null
let termRunning = false;
let pipeLine = ''; // line buffer of the pipe mode (with no pty the echo is local)

export function getXterm() {
  return xterm;
}

export function isTerminalRunning() {
  return termRunning;
}

export function applyTerminalTheme() {
  if (!xterm) return;
  xterm.options.theme = {
    background: cssVar('--bg-2') || '#191d23',
    foreground: cssVar('--ink') || '#bcc2c9',
    cursor: cssVar('--accent') || '#4fc7bb',
    selectionBackground: 'rgba(' + (cssVar('--accent-rgb') || '79,199,187') + ',0.25)'
  };
}

onThemeApplied(applyTerminalTheme);

function ensureXterm() {
  if (xterm) return;
  xterm = new Terminal({
    fontFamily: cssVar('--font-code') || '"JetBrains Mono","Cascadia Mono",Consolas,monospace',
    fontSize: 13,
    cursorBlink: true,
    convertEol: true,
    scrollback: 4000
  });
  fitAddon = new FitAddon.FitAddon();
  xterm.loadAddon(fitAddon);
  xterm.open(terminalHost);
  applyTerminalTheme();

  xterm.onData((data) => {
    if (!termRunning) return;
    if (termKind === 'pty') {
      window.wired.termInput(data);
      return;
    }
    // Pipe mode: local line editing, because powershell without a pty does not echo.
    for (const ch of data) {
      if (ch === '\r') {
        xterm.write('\r\n');
        window.wired.termInput(pipeLine + '\r\n');
        pipeLine = '';
      } else if (ch === '\x7f' || ch === '\b') {
        if (pipeLine.length > 0) {
          pipeLine = pipeLine.slice(0, -1);
          xterm.write('\b \b');
        }
      } else if (ch === '\x03') {
        interruptTerminal();
      } else if (ch >= ' ' || ch === '\t') {
        pipeLine += ch;
        xterm.write(ch);
      }
    }
  });

  xterm.onResize(({ cols, rows }) => {
    if (termRunning) window.wired.termResize(cols, rows);
  });

  window.wired.onTermData((d) => {
    if (xterm) xterm.write(d);
  });

  window.wired.onTermExit((code) => {
    termRunning = false;
    if (xterm) xterm.write('\r\n[process ended, exit code ' + code + ']\r\n');
  });

  new ResizeObserver(() => {
    if (!terminalPanel.classList.contains('hidden') && fitAddon) {
      try {
        fitAddon.fit();
      } catch {}
    }
  }).observe(terminalHost);
}

async function interruptTerminal() {
  const res = await window.wired.termInterrupt();
  if (res && res.restarted) {
    pipeLine = '';
    termRunning = true;
    xterm.write('\r\n[command interrupted, shell restarted]\r\n');
  }
}

async function startTerminal() {
  const pane = activePane();
  const cwd = pane && pane.path ? dirName(pane.path) : null;
  ensureXterm();
  fitAddon.fit();
  const res = await window.wired.termStart(cwd, xterm.cols, xterm.rows);
  if (!res.ok) {
    xterm.write('\r\n[could not start the shell: ' + res.error + ']\r\n');
    return;
  }
  termKind = res.kind;
  termRunning = true;
  pipeLine = '';
  terminalCwd.textContent = res.cwd || '';
  if (res.kind === 'pipe') {
    xterm.write('[compatibility mode: no pty, local echo; Ctrl+C restarts the shell]\r\n');
  }
}

export function toggleTerminal(forceOpen) {
  const isHidden = terminalPanel.classList.contains('hidden');
  const open = forceOpen === undefined ? isHidden : forceOpen;
  if (open) {
    terminalPanel.classList.remove('hidden');
    applyTerminalHeight();
    ensureXterm();
    requestAnimationFrame(() => {
      fitAddon.fit();
      xterm.focus();
    });
    if (!termRunning) startTerminal();
  } else {
    terminalPanel.classList.add('hidden');
    const pane = activePane();
    if (pane && pane.vditor) pane.vditor.focus();
  }
}

// --- resizable panel: dragging the top edge changes the height, clamped from
// 120px to 70% of the window and persisted. The xterm fit happens during the
// drag through the ResizeObserver on the host. ---

function clampTermHeight(h) {
  return Math.max(120, Math.min(Math.round(window.innerHeight * 0.7), Math.round(h)));
}

export function setTerminalHeight(h) {
  const v = clampTermHeight(h);
  config.terminalHeight = v;
  terminalPanel.style.height = v + 'px';
}

function applyTerminalHeight() {
  terminalPanel.style.height = clampTermHeight(Number(config.terminalHeight) || 260) + 'px';
}

// Types a command line into the open shell (pty or pipe), with Enter.
export function termType(cmd) {
  if (!termRunning) return;
  if (termKind === 'pty') {
    window.wired.termInput(cmd + '\r');
  } else {
    xterm.write(cmd + '\r\n');
    window.wired.termInput(cmd + '\r\n');
    pipeLine = '';
  }
}

// Types text into the shell WITHOUT Enter (the cursor stays at the end, waiting
// for the owner). This is what keeps the AI bridge from ever sending on its own.
export function termTypeRaw(text) {
  if (!termRunning) return;
  if (termKind === 'pty') {
    window.wired.termInput(text);
  } else {
    xterm.write(text);
    pipeLine += text;
  }
}

// The visible xterm buffer as text (used to detect a TUI coming up).
export function getTermBuffer() {
  if (!xterm) return '';
  const out = [];
  const b = xterm.buffer.active;
  for (let i = 0; i < b.length; i++) {
    const l = b.getLine(i);
    if (l) out.push(l.translateToString(true));
  }
  return out.join('\n');
}

export function focusTerminal() {
  if (xterm) xterm.focus();
}

// Sends the open shell to the folder of the current note (cd), without
// restarting the terminal.
export function cdTerminalToNote() {
  const pane = activePane();
  if (!pane || !pane.path || !termRunning) return;
  const dir = dirName(pane.path);
  termType('cd "' + dir + '"');
  terminalCwd.textContent = dir;
  xterm.focus();
}

export function initTerminal() {
  document.getElementById('btn-term-close').addEventListener('click', () => toggleTerminal(false));
  document.getElementById('btn-term-cd').addEventListener('click', cdTerminalToNote);
  document.getElementById('btn-terminal').addEventListener('click', () => toggleTerminal());

  // Types the claude command into the shell, Enter included: this button is the
  // explicit "start a session", not the bridge.
  document.getElementById('btn-claude').addEventListener('click', () => {
    toggleTerminal(true);
    setTimeout(() => termType('claude'), 300);
  });

  let resizing = false;
  terminalResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizing = true;
    document.body.classList.add('resizing-terminal');
  });
  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    setTerminalHeight(terminalPanel.getBoundingClientRect().bottom - e.clientY);
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove('resizing-terminal');
    saveConfig();
  });
}
