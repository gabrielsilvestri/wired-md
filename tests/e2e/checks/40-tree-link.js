// A note dragged from the sidebar tree into another note becomes a relative
// link where it lands. A real OS drag cannot be synthesized, so the check
// dispatches the DragEvents with a DataTransfer, which Chromium honors.

async function run(ctx) {
  const { js, check, fs, path, userDir, openPath, until, forget, demoPath, fixtures, sleep } = ctx;

  // --- the relative path itself ---
  const rel = await js(`(function(){var r=window.wiredLinks.relativeLink;return [` +
    `r('C:\\\\a\\\\b\\\\note.md','C:\\\\a\\\\b\\\\refs\\\\x y.md'),` +
    `r('C:\\\\a\\\\b\\\\note.md','C:\\\\a\\\\c.md'),` +
    `r('C:\\\\a\\\\b\\\\note.md','c:\\\\A\\\\b\\\\same.md'),` +
    `r('C:\\\\a\\\\note.md','D:\\\\x\\\\y.md')];})()`);
  check(
    'tree link: the link is relative to the note, forward slashes, encoded, and a file URL across drives',
    JSON.stringify(rel) === JSON.stringify(['refs/x%20y.md', '../c.md', 'same.md', 'file:///D:/x/y.md']),
    JSON.stringify(rel)
  );

  // --- the tree row carries its path when dragged ---
  const dragged = await js(`(function(){var row=[...document.querySelectorAll('#file-tree .tree-row.file')].find(function(r){return r.title===${JSON.stringify(fixtures.notes)};});` +
    `if(!row)return null;var dt=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt,bubbles:true}));` +
    `return {draggable:row.draggable,path:dt.getData(window.wiredLinks.TREE_DRAG_TYPE)};})()`);
  check('tree link: a file row is draggable and carries its path', !!dragged && dragged.draggable === true && dragged.path === fixtures.notes, JSON.stringify(dragged));

  // --- dropped on a note, it becomes a link there ---
  const dir = userDir('tree-link-check');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  const note = path.join(dir, 'note.md');
  const target = path.join(dir, 'refs', 'style guide.md');
  fs.writeFileSync(note, '# Note\n\nSee here.\n', 'utf8');
  fs.writeFileSync(target, '# Style guide\n', 'utf8');
  const find = `panes.find(function(x){return x.path===${JSON.stringify(note)};})`;
  try {
    await openPath(note);
    await until(`!!panes.find(function(x){return x.path===${JSON.stringify(note)}&&x.ready;})`);
    await js(`setPaneDirty(${find},false)`);
    await js(`(function(){var p=${find};var el=p.el.querySelector('.vditor-ir .vditor-reset p')||p.el.querySelector('.vditor-ir .vditor-reset');` +
      `var b=el.getBoundingClientRect();var dt=new DataTransfer();dt.setData(window.wiredLinks.TREE_DRAG_TYPE,${JSON.stringify(target)});` +
      `el.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true,clientX:b.right-2,clientY:b.top+b.height/2}));})()`);
    await sleep(300);
    const after = await js(`(function(){var p=${find};return {text:p.vditor.getValue(),dirty:p.dirty};})()`);
    check(
      'tree link: dropped on a note it inserts [name](relative path) and marks the note unsaved',
      !!after && after.text.includes('[style guide](refs/style%20guide.md)') && after.dirty === true,
      JSON.stringify(after)
    );
    const resolved = await js(`window.wired.resolveLink(${JSON.stringify(note)},'refs/style%20guide.md')`);
    check('tree link: the inserted link resolves to the dragged file, so Ctrl+click opens it', !!resolved && resolved.ok && resolved.path === target, JSON.stringify(resolved));
  } finally {
    await js(`(function(){var p=${find};if(p){setPaneDirty(p,false);closePane(p);}})()`);
    await forget(['tree-link-check']);
    fs.rmSync(dir, { recursive: true, force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
