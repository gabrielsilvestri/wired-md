// The live instance's half of the wired-md CLI (EXPERIMENTAL).
//
// The idea: the editor is a window an AI agent can already see, so let the agent
// drive it from the terminal it already lives in. `wired open notes.md` puts the
// file in front of the human while the agent keeps writing to disk.
//
// TRANSPORT: no daemon, no server, no port, no custom URI scheme. bin/wired.js
// launches the app again with a `--wired-cli <base64 json>` argument; Electron's
// single instance lock hands that argv to the RUNNING window through the
// `second-instance` event and the second process dies immediately. A command
// that has an answer to give (list) passes a reply file path, which this side
// writes and the CLI polls.
//
// Antiscope for v1: no content editing over the CLI. The agent edits .md files
// on disk directly and the app's watcher picks the change up.

const path = require('path');
const fs = require('fs');

// TRAP, and it cost a debugging round: the payload has to travel as ONE token,
// `--wired-cli=<value>`. Chromium rewrites the argv it hands to `second-instance`
// (it sorts its own switches to the front and injects its own), so a flag and a
// separate value argument arrive split apart, with unrelated switches wedged in
// between. A single `--switch=value` token survives intact.
const FLAG = '--wired-cli';
const FLAG_PREFIX = FLAG + '=';

// The payload travels base64 encoded, so a note path with spaces, quotes or a
// non ASCII name survives every shell and Windows argv quoting rule intact.
function encodeCommand(cmd) {
  return FLAG_PREFIX + Buffer.from(JSON.stringify(cmd), 'utf8').toString('base64');
}

function parseArgv(argv) {
  const token = (argv || []).find((a) => typeof a === 'string' && a.startsWith(FLAG_PREFIX));
  if (!token) return null;
  try {
    const cmd = JSON.parse(Buffer.from(token.slice(FLAG_PREFIX.length), 'base64').toString('utf8'));
    return cmd && typeof cmd.cmd === 'string' ? cmd : null;
  } catch {
    return null;
  }
}

function reply(cmd, payload) {
  if (!cmd || !cmd.reply) return;
  try {
    fs.writeFileSync(cmd.reply, JSON.stringify(payload), 'utf8');
  } catch {}
}

function jsString(v) {
  return JSON.stringify(String(v == null ? '' : v));
}

// Template variables, the small subset that makes sense with no human at the
// keyboard: {{ask:...}} and {{cursor}} are interactive by nature and are left
// untouched (an unknown marker is never an error).
function applyTemplateVars(text, title, folder) {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const date = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  const time = two(d.getHours()) + ':' + two(d.getMinutes());
  return String(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, key) => {
    const low = key.trim().toLowerCase();
    if (low === 'date') return date;
    if (low === 'time') return time;
    if (low === 'title') return title;
    if (low === 'folder') return folder;
    if (low === 'cursor') return '';
    return whole;
  });
}

// Characters Windows refuses in a file name, as a string built regex so no
// escaping subtlety of a literal gets in the way.
const RE_UNSAFE_NAME = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001f]', 'g');

function safeFileName(title) {
  const clean = String(title || '')
    .trim()
    .replace(RE_UNSAFE_NAME, '-')
    .replace(new RegExp('\\s+', 'g'), ' ')
    .slice(0, 80)
    .trim();
  const base = clean || 'untitled';
  return /\.(md|markdown)$/i.test(base) ? base : base + '.md';
}

// Runs one command against the live window. `deps` carries what main owns:
// the BrowserWindow, the folder the CLI was invoked from and the templates dir.
async function execute(cmd, deps) {
  try {
    await run(cmd, deps);
  } catch (err) {
    // Never leave the CLI hanging on a silence: an exception here is still an
    // answer the other side has to receive.
    reply(cmd, { ok: false, error: String(err && err.message ? err.message : err) });
  }
}

async function run(cmd, deps) {
  const win = deps.getWindow ? deps.getWindow() : null;
  if (!cmd) return;
  if (!win || win.isDestroyed()) {
    reply(cmd, { ok: false, error: 'no window' });
    return;
  }
  const focus = () => {
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } catch {}
  };

  if (cmd.cmd === 'open') {
    const file = path.resolve(cmd.cwd || process.cwd(), cmd.file || '');
    if (!fs.existsSync(file)) {
      reply(cmd, { ok: false, error: 'file not found: ' + file });
      return;
    }
    win.webContents.send('open-file-path', file);
    focus();
    reply(cmd, { ok: true, opened: file });
    return;
  }

  if (cmd.cmd === 'focus') {
    const file = path.resolve(cmd.cwd || process.cwd(), cmd.file || '');
    const found = await win.webContents.executeJavaScript(
      `(function(){var t=${jsString(file)}.toLowerCase();var p=panes.find(function(x){return x.path&&x.path.toLowerCase()===t;});if(!p)return false;void openPath(p.path,false);return true;})()`,
      true
    );
    if (found) focus();
    reply(cmd, found ? { ok: true, focused: file } : { ok: false, error: 'not open: ' + file });
    return;
  }

  if (cmd.cmd === 'list') {
    const files = await win.webContents.executeJavaScript(
      `panes.map(function(p){return {path:p.path,dirty:!!p.dirty,active:p.id===(activePane()?activePane().id:null)};})`,
      true
    );
    reply(cmd, { ok: true, files: files || [] });
    return;
  }

  if (cmd.cmd === 'new') {
    const title = cmd.title || 'untitled';
    let content = '';
    if (cmd.template) {
      const name = /\.(md|markdown)$/i.test(cmd.template) ? cmd.template : cmd.template + '.md';
      const tpl = path.join(deps.templatesDir, name);
      if (!fs.existsSync(tpl)) {
        reply(cmd, { ok: false, error: 'template not found: ' + name });
        return;
      }
      try {
        content = fs.readFileSync(tpl, 'utf8');
      } catch (err) {
        reply(cmd, { ok: false, error: String(err.message || err) });
        return;
      }
    }
    // Where the file lands: the folder of the tree the app has open, and the
    // folder the CLI was invoked from when there is no tree.
    let dir = null;
    try {
      dir = await win.webContents.executeJavaScript('treeRoot', true);
    } catch {}
    if (!dir) dir = cmd.cwd || process.cwd();
    const target = path.join(dir, safeFileName(title));
    if (fs.existsSync(target)) {
      reply(cmd, { ok: false, error: 'already exists: ' + target });
      return;
    }
    try {
      fs.writeFileSync(target, applyTemplateVars(content, title, path.basename(dir)), 'utf8');
    } catch (err) {
      reply(cmd, { ok: false, error: String(err.message || err) });
      return;
    }
    win.webContents.send('open-file-path', target);
    focus();
    reply(cmd, { ok: true, created: target });
    return;
  }

  reply(cmd, { ok: false, error: 'unknown command: ' + cmd.cmd });
}

// A marker file so the CLI can tell, without paying for an Electron start up,
// whether an instance is live in this profile. It carries the pid and the app
// root, and it is removed on quit.
function instanceFile(userDataDir) {
  return path.join(userDataDir, 'cli-instance.json');
}

function writeInstanceFile(userDataDir, appRoot) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(instanceFile(userDataDir), JSON.stringify({ pid: process.pid, appRoot }), 'utf8');
  } catch {}
}

function clearInstanceFile(userDataDir) {
  try {
    fs.unlinkSync(instanceFile(userDataDir));
  } catch {}
}

module.exports = { FLAG, FLAG_PREFIX, encodeCommand, parseArgv, execute, instanceFile, writeInstanceFile, clearInstanceFile, safeFileName, applyTemplateVars };
