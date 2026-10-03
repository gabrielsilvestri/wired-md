// The right click menu of a tree file offers "insert link in the open note",
// the keyboard and mouse twin of dragging the row into the text. It is absent
// when the row is the open note itself.

async function run(ctx) {
  const { js, check, fs, path, userDir, openPath, until, forget, demoPath, sleep } = ctx;

  const dir = userDir('menu-link-check');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const note = path.join(dir, 'note.md');
  const other = path.join(dir, 'other.md');
  fs.writeFileSync(note, '# Note\n\nLinks:\n', 'utf8');
  fs.writeFileSync(other, '# Other\n', 'utf8');
  const find = `panes.find(function(x){return x.path===${JSON.stringify(note)};})`;
  // Opens the file menu for a path through the same function the tree row calls.
  const menuFor = (p) => js(`(async function(){var m=await import('./modules/context-menu.js');m.showFileContextMenu({clientX:40,clientY:40},${JSON.stringify(p)});` +
    `return [...document.querySelectorAll('#ctx-menu .ctx-item')].map(function(r){return r.textContent;});})()`);

  try {
    await openPath(note);
    await until(`!!panes.find(function(x){return x.path===${JSON.stringify(note)}&&x.ready;})`);
    await js(`setPaneDirty(${find},false)`);

    const self = await menuFor(note);
    await js(`document.getElementById('ctx-menu').classList.add('hidden')`);
    check('menu link: no "insert link" on the open note itself', Array.isArray(self) && !self.includes('insert link in the open note'), JSON.stringify(self));

    // The caret at the end of the last paragraph, then the menu item.
    await js(`(function(){var p=${find};p.vditor.focus();var ps=p.el.querySelectorAll('.vditor-ir .vditor-reset p');var last=ps[ps.length-1];` +
      `var r=document.createRange();r.selectNodeContents(last);r.collapse(false);var s=window.getSelection();s.removeAllRanges();s.addRange(r);})()`);
    // A right click on the tree takes the focus and the selection out of the
    // editor first; the link still has to land where the caret was.
    await js(`(function(){document.activeElement.blur();var t=document.querySelector('#file-tree .tree-row')||document.body;var r=document.createRange();r.selectNodeContents(t);var s=window.getSelection();s.removeAllRanges();s.addRange(r);})()`);
    const items = await menuFor(other);
    await js(`(function(){var row=[...document.querySelectorAll('#ctx-menu .ctx-item')].find(function(r){return r.textContent==='insert link in the open note';});if(row)row.click();})()`);
    await sleep(300);
    const after = await js(`(function(){var p=${find};return {text:p.vditor.getValue(),dirty:p.dirty};})()`);
    check(
      'menu link: "insert link in the open note" puts [other](other.md) at the caret and marks it unsaved',
      Array.isArray(items) && items.includes('insert link in the open note') && !!after && /Links:\s*\[other\]\(other\.md\)/.test(after.text) && after.dirty === true,
      JSON.stringify({ items, after })
    );
  } finally {
    await js(`(function(){var p=${find};if(p){setPaneDirty(p,false);closePane(p);}})()`);
    await forget(['menu-link-check']);
    fs.rmSync(dir, { recursive: true, force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
