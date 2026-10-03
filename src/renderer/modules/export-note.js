// Export the note as a standalone HTML page or a PDF, the way it reads in the
// editor: the active theme's colors, its accent, the document font and width.
// The page is self contained (no script, no network); the PDF is that page
// printed by a hidden window in the main process (src/main/ipc/fs.js).
//
// The frontmatter is metadata for the agent that reads the file, so it is left
// out of what a person reads. The tree's "export" still copies the .md itself.
import { activePane, baseName } from './state.js';
import { registerPaletteAction } from './palette.js';
import { paneText } from './text-cache.js';
import { notify } from './toast.js';

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

// Only theme variables: the colors come from whatever theme is active.
const EXPORT_CSS = `
html { background: var(--bg); }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body), "Segoe UI", system-ui, sans-serif; font-size: 16px; line-height: 1.65; }
main { max-width: 760px; margin: 0 auto; padding: 48px 32px 64px; }
h1, h2, h3, h4, h5, h6 { color: var(--accent); line-height: 1.3; margin: 1.6em 0 0.6em; }
h1 { font-size: 1.9em; border-bottom: 1px solid var(--rule); padding-bottom: 0.3em; }
h2 { font-size: 1.45em; } h3 { font-size: 1.2em; } h4, h5, h6 { font-size: 1em; }
a { color: var(--accent); }
code, pre { font-family: var(--font-code), "Cascadia Mono", Consolas, monospace; font-size: 0.9em; }
:not(pre) > code { background: var(--bg-2); padding: 0.1em 0.35em; border-radius: 4px; }
pre { background: var(--bg-2); padding: 14px 16px; border-radius: 8px; overflow-x: auto; line-height: 1.5; }
blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 3px solid var(--accent); color: var(--ink-dim); }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid var(--rule); padding: 6px 12px; }
th { background: var(--bg-2); }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2em 0; }
img { max-width: 100%; }
@page { margin: 0; }
@media print { main { padding: 40px 48px; -webkit-box-decoration-break: clone; box-decoration-break: clone; } pre { white-space: pre-wrap; } h1, h2, h3 { break-after: avoid; } pre, table, blockquote { break-inside: avoid; } }
`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// `text` renders that Markdown instead of the editor's (the CLI exports what is
// on disk, which an agent may have rewritten a moment ago); the pane still
// lends its Lute, whose link base resolves the note's relative images.
export function noteHTML(pane, text) {
  const md = (typeof text === 'string' ? text : paneText(pane)).replace(FRONTMATTER, '');
  const lute = pane.vditor.vditor && pane.vditor.vditor.lute;
  const body = lute ? lute.Md2HTML(md) : '<pre>' + escapeHtml(md) + '</pre>';
  const heading = /^#\s+(.+)$/m.exec(md);
  const title = heading ? heading[1].trim() : pane.path ? baseName(pane.path).replace(/\.(md|markdown)$/i, '') : 'untitled';
  const theme = (document.getElementById('theme-style') || {}).textContent || '';
  const custom = (document.getElementById('custom-style') || {}).textContent || '';
  const font = getComputedStyle(document.documentElement);
  const fonts = ':root{--font-body:' + font.getPropertyValue('--font-body') + ';--font-code:' + font.getPropertyValue('--font-code') + ';}';
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><style>' + theme + '\n' + custom + '\n' + fonts + EXPORT_CSS + '</style></head>' +
    '<body><main>' + body + '</main></body></html>\n';
}

// `target` skips the save dialog; main honors it only in the test suite.
// `which` is the pane a right click came from; the palette exports the active one.
export async function exportNote(kind, target, which) {
  const pane = which || activePane();
  if (!pane || !pane.vditor) {
    notify('No note open to export.');
    return null;
  }
  const name = (pane.path ? baseName(pane.path).replace(/\.(md|markdown)$/i, '') : 'untitled') + '.' + kind;
  const res = await window.wired.exportRendered(kind, noteHTML(pane), name, target || null);
  if (res && !res.ok && !res.canceled) notify('Could not export: ' + res.error);
  return res;
}

registerPaletteAction({ label: 'export note as HTML', hint: 'a standalone page in the active theme', run: () => void exportNote('html') });
registerPaletteAction({ label: 'export note as PDF', hint: 'the same page, printed', run: () => void exportNote('pdf') });

window.wiredExport = { noteHTML, exportNote };
