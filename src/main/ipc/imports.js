// CLAUDE.md imports: `@path/to/file` pulls another file into the memory Claude
// Code loads. This walks them the way Claude Code does (relative to the file
// that holds the import, `~` for the home folder, nothing inside code, a few
// hops deep at most), so the editor can say how much context a CLAUDE.md really
// costs and open what it imports. It only ever READS.

const { ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const MAX_DEPTH = 4; // "a maximum depth of four hops" (code.claude.com/docs/en/memory)
const MAX_FILES = 200; // a ceiling against a pathological tree, never reached by hand
const MAX_BYTES = 2 * 1024 * 1024; // a file bigger than this is not memory, it is a mistake

// Fenced blocks and code spans are not imports (`@types/node` in backticks).
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// An import starts a word: start of line or after whitespace, then @ and a path.
// The lookbehind keeps an email address (name@host) out. A space inside the
// path is written "\ " (the docs' `@Design\ Docs/api.md`); a quoted path is
// not an import at all, so a leading quote never matches.
const IMPORT = /(?<![^\s(])@((?:\\ |[^\s`'"<>|*?()\[\]])+)/g;

function stripCodeSpans(line) {
  return line.replace(/(`+)[\s\S]*?\1/g, (m) => ' '.repeat(m.length));
}

// The raw import paths of a Markdown source, in order, without duplicates.
function parseImports(source) {
  const out = [];
  let fence = null;
  for (const line of String(source || '').split(/\r?\n/)) {
    const f = line.match(FENCE);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    for (const m of stripCodeSpans(line).matchAll(IMPORT)) {
      // Sentence punctuation after a path is prose, not part of the path.
      const raw = m[1].replace(/[.,;:!]+$/, '').replace(/\\ /g, ' ');
      if (raw && !out.includes(raw)) out.push(raw);
    }
  }
  return out;
}

function resolveImport(fromFile, raw) {
  let p = raw;
  if (/^~[\\/]/.test(p)) p = path.join(os.homedir(), p.slice(2));
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(path.dirname(fromFile), p);
}

function readSmall(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return { exists: false };
    if (st.size > MAX_BYTES) return { exists: true, chars: st.size, tooBig: true };
    return { exists: true, text: fs.readFileSync(p, 'utf8') };
  } catch {
    return { exists: false };
  }
}

// Every file reachable from a note through imports, breadth first, each once.
// `chars` is what reaches the context window; a missing file reports itself so
// the editor can flag the broken import instead of counting it as zero.
function scanImports(notePath, source) {
  if (!notePath) return { ok: true, items: [], chars: 0 };
  const seen = new Set([path.normalize(notePath).toLowerCase()]);
  const items = [];
  let queue = parseImports(source).map((raw) => ({ raw, from: notePath, depth: 1 }));
  while (queue.length && items.length < MAX_FILES) {
    const next = [];
    for (const imp of queue) {
      const abs = resolveImport(imp.from, imp.raw);
      const key = abs.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const r = readSmall(abs);
      const item = { raw: imp.raw, path: abs, depth: imp.depth, exists: r.exists, chars: r.text !== undefined ? r.text.length : r.chars || 0 };
      items.push(item);
      if (r.text !== undefined && imp.depth < MAX_DEPTH) {
        for (const raw of parseImports(r.text)) next.push({ raw, from: abs, depth: imp.depth + 1 });
      }
    }
    queue = next;
  }
  const chars = items.reduce((n, it) => n + (it.exists ? it.chars : 0), 0);
  return { ok: true, items, chars, truncated: items.length >= MAX_FILES };
}

// One import under the pointer: where it points and whether it is there.
function resolveOne(notePath, raw) {
  if (!notePath) return { ok: false, error: 'save the note first: imports resolve against its folder' };
  const clean = String(raw || '').replace(/^@/, '').replace(/[.,;:!]+$/, '').replace(/\\ /g, ' ');
  if (!clean) return { ok: false, error: 'empty import' };
  const abs = resolveImport(notePath, clean);
  const r = readSmall(abs);
  return { ok: true, path: abs, exists: r.exists, markdown: /\.(md|markdown)$/i.test(abs) };
}

function register() {
  ipcMain.handle('imports:scan', (_ev, notePath, source) => scanImports(notePath, source));
  ipcMain.handle('imports:resolve', (_ev, notePath, raw) => resolveOne(notePath, raw));
}

module.exports = { register, parseImports, scanImports, resolveOne, MAX_DEPTH };
