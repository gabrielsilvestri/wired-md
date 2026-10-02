// Full text search inside the folder of the open note (Ctrl+Shift+F).
//
// Preferred engine: the ripgrep binary that ships in the @vscode/ripgrep package
// (offline, no dependency on an rg installed on the machine). That package is
// ESM and main is CJS, so the binary is resolved straight from the platform
// subpackage. Without it, the handler falls back to a recursive scan in plain
// Node (note folders here are small, the cost is irrelevant).

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { MAX_DEPTH, isHiddenEntry, isHiddenPath } = require('./tree');

const SEARCH_MAX = 200; // ceiling of returned matches; above it the result is flagged truncated
const SEARCH_LINE_MAX = 240; // ceiling of characters shown for one result line

// PACKAGED BUILD TRAP: inside an installed app, require.resolve answers with a
// path INSIDE app.asar, and an archive member cannot be executed. The binary is
// listed in asarUnpack, so the real file sits in app.asar.unpacked under the same
// relative path. Rewriting that one path segment is the whole fix; in dev the
// path has no `app.asar` in it and this is a no-op.
function unpacked(p) {
  return p.split(path.sep + 'app.asar' + path.sep).join(path.sep + 'app.asar.unpacked' + path.sep);
}

// WIRED_SEARCH_ENGINE=node forces the fallback (useful to exercise that path).
let rgPath = null;
try {
  if (process.env.WIRED_SEARCH_ENGINE === 'node') throw new Error('fallback forced');
  const bin = process.platform === 'win32' ? 'rg.exe' : 'rg';
  rgPath = unpacked(require.resolve('@vscode/ripgrep-' + process.platform + '-' + process.arch + '/bin/' + bin));
  if (!fs.existsSync(rgPath)) rgPath = null;
} catch {
  rgPath = null;
}

// Crops a long line around the match so the highlighted part stays visible.
function windowLine(text, start, end) {
  if (text.length <= SEARCH_LINE_MAX) return { text, start, end };
  const slack = Math.max(0, Math.floor((SEARCH_LINE_MAX - (end - start)) / 2));
  let from = Math.max(0, start - slack);
  let to = Math.min(text.length, from + SEARCH_LINE_MAX);
  from = Math.max(0, to - SEARCH_LINE_MAX);
  const prefix = from > 0 ? '...' : '';
  const suffix = to < text.length ? '...' : '';
  return {
    text: prefix + text.slice(from, to) + suffix,
    start: start - from + prefix.length,
    end: Math.min(end, to) - from + prefix.length
  };
}

// Groups loose matches by file. Sorted by path on purpose: ripgrep scans in
// parallel and returns files in an unpredictable order, and a list that dances
// on every keystroke is unreadable.
function groupMatches(matches) {
  const byFile = new Map();
  for (const m of matches) {
    if (!byFile.has(m.path)) byFile.set(m.path, { path: m.path, name: path.basename(m.path), matches: [] });
    byFile.get(m.path).matches.push({ line: m.line, text: m.text, start: m.start, end: m.end });
  }
  return [...byFile.values()].sort((a, b) => a.path.localeCompare(b.path));
}

const SEARCH_GLOBS = ['-g', '*.md', '-g', '*.markdown', '-g', '!node_modules/**', '-g', '!.git/**', '-g', '!.obsidian/**', '-g', '!.trash/**'];

function searchWithRipgrep(root, query) {
  return new Promise((resolve) => {
    // --hidden lets rg into .claude and its siblings; every other dot path is
    // dropped below by the same rule the tree uses.
    const args = ['--json', '--smart-case', '--fixed-strings', '--no-ignore', '--hidden', ...SEARCH_GLOBS, '--', query, '.'];
    const proc = spawn(rgPath, args, { cwd: root, windowsHide: true });
    const matches = [];
    let truncated = false;
    let rest = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve({ matches, truncated });
    };
    proc.stdout.on('data', (chunk) => {
      rest += chunk.toString('utf8');
      const lines = rest.split('\n');
      rest = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type !== 'match') continue;
        if (isHiddenPath(ev.data.path.text || '')) continue;
        const abs = path.resolve(root, ev.data.path.text || '');
        const rawLine = (ev.data.lines.text || '').replace(/\r?\n$/, '');
        const buf = Buffer.from(rawLine, 'utf8');
        for (const sub of ev.data.submatches || []) {
          if (matches.length >= SEARCH_MAX) {
            truncated = true;
            try {
              proc.kill();
            } catch {}
            finish();
            return;
          }
          // rg reports offsets in BYTES; the list renders characters, so any
          // accented line would misalign the highlight without this conversion.
          const start = buf.slice(0, sub.start).toString('utf8').length;
          const end = buf.slice(0, sub.end).toString('utf8').length;
          const w = windowLine(rawLine, start, end);
          matches.push({ path: abs, line: ev.data.line_number, text: w.text, start: w.start, end: w.end });
        }
      }
    });
    proc.on('error', () => {
      if (done) return;
      done = true;
      resolve(null); // engine broke: the caller falls back
    });
    proc.on('close', finish);
  });
}

// Plain Node fallback: same folder pruning as the file tree, literal search,
// case insensitive while the query is all lowercase.
function searchWithNode(root, query) {
  const matches = [];
  let truncated = false;
  const insensitive = query === query.toLowerCase();
  const needle = insensitive ? query.toLowerCase() : query;
  const walk = (dir, depth) => {
    if (truncated || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (truncated) return;
      if (isHiddenEntry(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(md|markdown)$/i.test(e.name)) continue;
      let content;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const haystack = insensitive ? rawLine.toLowerCase() : rawLine;
        let at = haystack.indexOf(needle);
        while (at !== -1) {
          if (matches.length >= SEARCH_MAX) {
            truncated = true;
            return;
          }
          const w = windowLine(rawLine, at, at + query.length);
          matches.push({ path: full, line: i + 1, text: w.text, start: w.start, end: w.end });
          at = haystack.indexOf(needle, at + query.length);
        }
      }
    }
  };
  walk(root, 0);
  return { matches, truncated };
}

function register() {
  console.log('[wired-md] full text search: ' + (rgPath ? 'ripgrep (' + rgPath + ')' : 'plain Node scan'));

  ipcMain.handle('search:folder', async (_ev, root, query) => {
    try {
      const term = String(query || '');
      if (!root || !fs.existsSync(root)) return { ok: false, error: 'folder does not exist', files: [], total: 0 };
      if (term.length < 2) return { ok: true, engine: 'none', files: [], total: 0, truncated: false };
      let res = null;
      let engine = 'node';
      if (rgPath) {
        res = await searchWithRipgrep(root, term);
        if (res) engine = 'ripgrep';
      }
      if (!res) res = searchWithNode(root, term);
      return { ok: true, engine, files: groupMatches(res.matches), total: res.matches.length, truncated: res.truncated };
    } catch (err) {
      return { ok: false, error: String(err.message || err), files: [], total: 0 };
    }
  });
}

module.exports = { register };
