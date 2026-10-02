// First run welcome: which AI CLIs are on PATH, whether the welcome may open on
// its own, and the two project links in its footer.
//
// Detection is a PATH scan, never a spawn: listing a folder cannot start a CLI,
// cannot hang on a login prompt and cannot spend anything. It is time bound and
// never throws; a folder that cannot be read is simply not where the CLI lives.

const { ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

// The AI CLIs people actually run from a terminal, by the command they type.
// The label is what the card shows under the command.
const KNOWN_CLIS = [
  { name: 'claude', label: 'Claude Code' },
  { name: 'codex', label: 'OpenAI Codex' },
  { name: 'gemini', label: 'Gemini CLI' },
  { name: 'aider', label: 'Aider' },
  { name: 'opencode', label: 'opencode' },
  { name: 'cursor-agent', label: 'Cursor Agent' },
  { name: 'qwen', label: 'Qwen Code' }
];

// Exact strings only. A prefix or a parsed host check would let a crafted URL
// through; these two are the whole list.
const ALLOWED_LINKS = new Set([
  'https://github.com/gabrielsilvestri/wired-md',
  'https://buymeacoffee.com/gabrielsilvestri'
]);

const DETECT_CEILING_MS = 3000;

// The file names a command can have on disk. On Windows that is the bare name
// plus every PATHEXT extension (npm installs `claude.cmd`, a native install
// `claude.exe`); elsewhere only the bare name, which the shell runs.
function candidateNames(name) {
  if (process.platform !== 'win32') return [name];
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [name, ...exts.map((e) => name + e)];
}

function pathDirs() {
  const raw = process.env.PATH || process.env.Path || '';
  const seen = new Set();
  const out = [];
  for (const d of raw.split(path.delimiter)) {
    const dir = d.trim().replace(/^"|"$/g, '');
    if (!dir) continue;
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

// One readdir per PATH folder instead of one stat per name and extension: a
// typical Windows PATH has forty folders and PATHEXT a dozen extensions.
async function scanPath() {
  const found = new Map(); // command name -> full path of the first hit
  const wanted = new Map(); // file name on disk (lowercase on Windows) -> command name
  for (const cli of KNOWN_CLIS) {
    for (const file of candidateNames(cli.name)) {
      wanted.set(process.platform === 'win32' ? file.toLowerCase() : file, cli.name);
    }
  }
  const listings = await Promise.all(
    pathDirs().map((dir) =>
      fs.promises.readdir(dir).then(
        (names) => ({ dir, names }),
        () => ({ dir, names: [] })
      )
    )
  );
  // PATH order decides which file wins, the same order the shell resolves in.
  for (const { dir, names } of listings) {
    for (const file of names) {
      const cmd = wanted.get(process.platform === 'win32' ? file.toLowerCase() : file);
      if (cmd && !found.has(cmd)) found.set(cmd, path.join(dir, file));
    }
  }
  return found;
}

async function detectClis() {
  let found = new Map();
  let complete = true;
  try {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), DETECT_CEILING_MS));
    const res = await Promise.race([scanPath(), timeout]);
    if (res) found = res;
    else complete = false;
  } catch {
    complete = false;
  }
  return {
    complete,
    clis: KNOWN_CLIS.map((c) => ({
      name: c.name,
      label: c.label,
      found: found.has(c.name),
      path: found.get(c.name) || null
    }))
  };
}

function register() {
  ipcMain.handle('onboarding:detect', () => detectClis());

  // The test modes boot a fresh profile every run, so a welcome that opened on
  // its own would sit on top of every check. The palette action still opens it.
  ipcMain.handle('onboarding:autoOpen', () => process.env.WIRED_E2E !== '1' && process.env.WIRED_SMOKE !== '1');

  ipcMain.handle('onboarding:openLink', async (_ev, url) => {
    if (typeof url !== 'string' || !ALLOWED_LINKS.has(url)) return { ok: false, error: 'not an allowed link' };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });
}

module.exports = { register, detectClis, KNOWN_CLIS, ALLOWED_LINKS };
