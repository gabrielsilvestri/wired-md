// Embedded terminal.
//
// Preferred backend: node-pty (a real terminal). If the native build does not
// load in this Electron, it falls back to child_process spawning powershell with
// pipes, and the renderer does local echo and line editing.

const { ipcMain, app } = require('electron');
const fs = require('fs');
const { spawn } = require('child_process');

let nodePty = null;
let ptyLoadError = null;
try {
  nodePty = require('node-pty');
} catch (err) {
  ptyLoadError = String(err.message || err);
}

let term = null; // { kind: 'pty' | 'pipe', proc, cwd }

function currentTerminal() {
  return term;
}

function killTerminal() {
  if (!term) return;
  const t = term;
  term = null;
  try {
    if (t.kind === 'pty') t.proc.kill();
    else {
      // Kills the whole powershell tree on Windows.
      spawn('taskkill', ['/pid', String(t.proc.pid), '/t', '/f'], { windowsHide: true });
    }
  } catch {}
}

function register({ send }) {
  console.log(nodePty ? '[wired-md] terminal backend: node-pty' : '[wired-md] node-pty unavailable, pipe fallback: ' + ptyLoadError);

  const startPipeShell = (cwd) => {
    const proc = spawn('powershell.exe', ['-NoLogo'], {
      cwd,
      windowsHide: true,
      env: Object.assign({}, process.env, { TERM: 'dumb' }),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    proc.stdout.on('data', (d) => send('term:data', d.toString('utf8')));
    proc.stderr.on('data', (d) => send('term:data', d.toString('utf8')));
    proc.on('exit', (code) => {
      if (term && term.proc === proc) term = null;
      send('term:exit', code === null ? -1 : code);
    });
    return { kind: 'pipe', proc, cwd };
  };

  ipcMain.handle('term:start', (_ev, cwd, cols, rows) => {
    killTerminal();
    const dir = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home');
    if (nodePty) {
      try {
        const proc = nodePty.spawn('powershell.exe', ['-NoLogo'], {
          name: 'xterm-256color',
          cols: cols || 100,
          rows: rows || 24,
          cwd: dir,
          env: process.env
        });
        proc.onData((d) => send('term:data', d));
        proc.onExit(({ exitCode }) => {
          if (term && term.proc === proc) term = null;
          send('term:exit', exitCode);
        });
        term = { kind: 'pty', proc, cwd: dir };
        return { ok: true, kind: 'pty', cwd: dir };
      } catch (err) {
        ptyLoadError = String(err.message || err);
      }
    }
    try {
      term = startPipeShell(dir);
      return { ok: true, kind: 'pipe', cwd: dir, ptyError: ptyLoadError };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.on('term:input', (_ev, data) => {
    if (!term) return;
    try {
      if (term.kind === 'pty') term.proc.write(data);
      else term.proc.stdin.write(data);
    } catch {}
  });

  // Interrupts the running command. On the pty that is a real Ctrl+C; on the
  // pipe fallback there is no way to send a signal, so the shell is killed and
  // another one comes up in the same cwd.
  ipcMain.handle('term:interrupt', () => {
    if (!term) return { restarted: false };
    if (term.kind === 'pty') {
      try {
        term.proc.write('\x03');
      } catch {}
      return { restarted: false };
    }
    const cwd = term.cwd;
    killTerminal();
    term = startPipeShell(cwd);
    return { restarted: true };
  });

  ipcMain.on('term:resize', (_ev, cols, rows) => {
    if (term && term.kind === 'pty') {
      try {
        term.proc.resize(cols, rows);
      } catch {}
    }
  });

  ipcMain.handle('term:kill', () => {
    killTerminal();
    return { ok: true };
  });
}

module.exports = { register, killTerminal, currentTerminal };
