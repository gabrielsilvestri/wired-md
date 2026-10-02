// Git status and diff for the folder of the open note.
//
// This talks to the `git` BINARY through child_process, never to a native
// library: no build step, no version pinned to Electron's ABI, and whatever git
// the owner already has is the one that answers.
//
// The whole feature degrades SILENTLY. No git on PATH, or a folder that is not a
// repository, means the renderer simply gets `ok: false` and draws nothing. No
// error dialog, no console noise: a markdown editor still works fine outside a
// repository.

const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// Ceiling for a single git call. A repository big enough to blow through this is
// a repository where the badges were not going to be useful anyway.
const GIT_TIMEOUT = 8000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

// Once git is known to be missing, stop paying for the spawn on every refresh.
let gitAbsent = false;

function runGit(cwd, args) {
  return new Promise((resolve) => {
    if (gitAbsent) {
      resolve({ ok: false, absent: true, stdout: '' });
      return;
    }
    let child;
    try {
      child = execFile(
        'git',
        args,
        // GIT_OPTIONAL_LOCKS=0: a plain `git status` refreshes the index and
        // takes .git/index.lock to do it. A status killed mid way (timeout, app
        // quitting) leaves that lock behind and the owner's next commit fails.
        // A read only badge has no business writing the index.
        { cwd, env: Object.assign({}, process.env, { GIT_OPTIONAL_LOCKS: '0' }), timeout: GIT_TIMEOUT, maxBuffer: GIT_MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
        (err, stdout, stderr) => {
          if (err) {
            // ENOENT means there is no git on PATH at all.
            if (err.code === 'ENOENT') gitAbsent = true;
            resolve({ ok: false, absent: err.code === 'ENOENT', error: String(stderr || err.message || err), stdout: stdout || '' });
            return;
          }
          resolve({ ok: true, stdout: stdout || '' });
        }
      );
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message ? err.message : err), stdout: '' });
      return;
    }
    child.on('error', () => {
      gitAbsent = true;
      resolve({ ok: false, absent: true, stdout: '' });
    });
  });
}

// Repository root of a folder, or null when the folder is outside any repo.
async function repoRoot(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const res = await runGit(dir, ['rev-parse', '--show-toplevel']);
  if (!res.ok) return null;
  const out = res.stdout.trim();
  if (!out) return null;
  // git answers with forward slashes even on Windows.
  return path.normalize(out);
}

// One letter per file, the way the badge reads it:
//   M modified (tracked and changed, staged or not)
//   A added (staged new file)
//   ? untracked
//   D deleted
//   R renamed
//   ! ignored
function letterFor(xy) {
  const x = xy[0];
  const y = xy[1];
  if (xy === '??') return '?';
  if (xy === '!!') return '!';
  if (x === 'R' || y === 'R') return 'R';
  if (x === 'A' || y === 'A') return 'A';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'M' || y === 'M' || x === 'T' || y === 'T') return 'M';
  if (x === 'U' || y === 'U') return 'M';
  return 'M';
}

// `git status --porcelain=v1 -z` is the stable, machine readable form: NUL
// separated records, no quoting or escaping of unusual file names to undo.
// A rename record carries TWO paths, so the parser consumes an extra field.
function parseStatus(root, raw) {
  const files = {};
  const ignoredDirs = [];
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec || rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    let rel = rec.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') {
      // The record is "<new path>\0<old path>": skip the old one.
      i += 1;
    }
    const isDir = rel.endsWith('/');
    if (isDir) rel = rel.slice(0, -1);
    const abs = path.normalize(path.join(root, rel));
    if (xy === '!!') {
      if (isDir) ignoredDirs.push(abs);
      else files[abs] = '!';
      continue;
    }
    files[abs] = letterFor(xy);
  }
  return { files, ignoredDirs };
}

// Splits a unified diff into typed lines the renderer can tint without parsing
// anything itself.
function parseDiff(raw) {
  const lines = [];
  for (const line of String(raw).split(/\r?\n/)) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') ||
        line.startsWith('new file mode') || line.startsWith('deleted file mode') || line.startsWith('similarity index') ||
        line.startsWith('rename from') || line.startsWith('rename to') || line.startsWith('old mode') || line.startsWith('new mode')) {
      continue;
    }
    if (line.startsWith('@@')) lines.push({ type: 'hunk', text: line });
    else if (line.startsWith('+')) lines.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) lines.push({ type: 'del', text: line.slice(1) });
    else if (line.startsWith('\\')) lines.push({ type: 'meta', text: line });
    else lines.push({ type: 'ctx', text: line.replace(/^ /, '') });
  }
  // Trailing blank from the final newline.
  while (lines.length > 0 && lines[lines.length - 1].type === 'ctx' && lines[lines.length - 1].text === '') lines.pop();
  return lines;
}

// A file git has never seen has no diff to ask for. Rather than leaning on
// `--no-index /dev/null`, which behaves differently per platform and per git
// build, the whole content is presented as added: same reading, zero surprises.
function wholeFileAsAdded(file) {
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rows = content.split(/\r?\n/);
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows.map((text) => ({ type: 'add', text }));
}

const MAX_DIFF_LINES = 4000;

function register() {
  ipcMain.handle('git:status', async (_ev, dir) => {
    const root = await repoRoot(dir);
    if (!root) return { ok: false };
    const res = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=traditional']);
    if (!res.ok) return { ok: false };
    const parsed = parseStatus(root, res.stdout);
    return { ok: true, root, files: parsed.files, ignoredDirs: parsed.ignoredDirs };
  });

  ipcMain.handle('git:diff', async (_ev, file) => {
    if (!file) return { ok: false };
    const dir = path.dirname(file);
    const root = await repoRoot(dir);
    if (!root) return { ok: false };
    const res = await runGit(root, ['diff', '--no-color', '--', file]);
    if (!res.ok) return { ok: false };
    let lines = parseDiff(res.stdout);
    let untracked = false;
    if (lines.length === 0) {
      // Either nothing changed, or the file is untracked (git diff says nothing
      // about a file it does not track).
      const known = await runGit(root, ['ls-files', '--error-unmatch', '--', file]);
      if (!known.ok) {
        untracked = true;
        lines = wholeFileAsAdded(file);
      }
    }
    const truncated = lines.length > MAX_DIFF_LINES;
    if (truncated) lines = lines.slice(0, MAX_DIFF_LINES);
    return { ok: true, root, file, untracked, truncated, lines };
  });
}

module.exports = { register, parseStatus, parseDiff, letterFor };
