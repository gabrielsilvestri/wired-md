// One Markdown reading of a pane per change, shared. Vditor's getValue()
// converts the whole editor DOM back to Markdown, about 300ms on a 4,000 line
// note, and the status bar, the outline, the memory imports, the properties
// panel and the recovery snapshots all want it after the same pause in typing.
// The text is cached until the editor DOM changes again.
//
// The observer's pending records are taken synchronously on every read, so a
// caller right after setValue (same task, before any observer callback has run)
// still gets the new text, never the cached old one.

const panesEl = document.getElementById('panes');
const cache = new WeakMap(); // pane -> { version, text }
let version = 0;

// Only a change inside an editor counts: the properties panel, the disk rows
// and the tab bar live in #panes too, and rebuilding them changes no Markdown.
function touchesEditor(records) {
  return records.some((r) => {
    const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
    return !!el && !!el.closest('.vditor-ir');
  });
}

const observer = new MutationObserver((records) => {
  if (touchesEditor(records)) version += 1;
});
observer.observe(panesEl, { subtree: true, childList: true, characterData: true, attributes: true });

export function paneText(pane) {
  if (!pane || !pane.vditor) return '';
  if (touchesEditor(observer.takeRecords())) version += 1;
  const hit = cache.get(pane);
  if (hit && hit.version === version) return hit.text;
  const text = pane.vditor.getValue();
  cache.set(pane, { version, text });
  return text;
}
