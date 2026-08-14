// Breadcrumb in the pane header: the note's folder relative to the tree root,
// clickable segments that reveal the folder, the folder button, the collapsed
// middle on a deep path, and no horizontal overflow in a narrow window.

async function run(ctx) {
  const { js, sleep, check, fs, path, win, forget, openPath, demoPath, rootDir } = ctx;

  win.setSize(1360, 840);
  await js('setSidebarVisible(true)');
  await sleep(500);

  const bcDir = path.join(rootDir, 'bc-e2e');
  const bcMid = path.join(bcDir, 'mid');
  const bcDeep = path.join(bcMid, 'deep');
  const bcNote = path.join(bcDir, 'note-bc.md');
  const bcDeepNote = path.join(bcDeep, 'note-deep.md');
  fs.mkdirSync(bcDeep, { recursive: true });
  fs.writeFileSync(bcNote, '# note bc\n', 'utf8');
  fs.writeFileSync(bcDeepNote, '# note deep\n', 'utf8');
  await sleep(1400);

  // The tree re-roots to the folder of the ACTIVE note. Opening the note in the
  // subfolder and then demo.md beside it puts the root back at examples, and the
  // inactive pane (note-bc) then shows a two segment relative path.
  await openPath(bcNote);
  await sleep(400);
  await js(`void openPath(${JSON.stringify(demoPath)}, true)`);
  await sleep(1200);

  const crumbs = await js(
    `(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(bcNote)};});if(!p)return null;var segs=[...p.crumbEl.querySelectorAll('.crumb-seg')];var fb=p.folderBtn;return {segs:segs.map(function(s){return s.textContent;}),seps:p.crumbEl.querySelectorAll('.crumb-sep').length,tip:p.crumbEl.title,clickable:segs.map(function(s){return s.classList.contains('clickable');}),folderBtn:!!fb&&!!fb.querySelector('svg')&&(fb.title||'').length>0&&fb.style.display!=='none',root:treeRoot};})()`
  );
  check(
    'breadcrumb: the pane shows the note folder relative to the root (examples / bc-e2e), clickable, with a folder button',
    !!crumbs && crumbs.segs.join('/') === 'examples/bc-e2e' && crumbs.seps === 1 && crumbs.tip === bcDir &&
      crumbs.clickable.every(Boolean) && crumbs.folderBtn && crumbs.root === rootDir,
    JSON.stringify(crumbs)
  );

  await js(
    `(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(bcNote)};});var segs=[...p.crumbEl.querySelectorAll('.crumb-seg.clickable')];segs[segs.length-1].click();})()`
  );
  await sleep(500);
  const revealed = await js(
    `(function(){var row=null,rows=document.querySelectorAll('#file-tree .tree-row.folder');for(var i=0;i<rows.length;i++){if(rows[i].title===${JSON.stringify(bcDir)}){row=rows[i];break;}}return {expanded:[...expandedDirs].indexOf(${JSON.stringify(bcDir)})!==-1,rowExists:!!row,sidebar:!document.getElementById('sidebar').classList.contains('hidden'),root:treeRoot,active:currentPath};})()`
  );
  check(
    'breadcrumb: clicking a segment reveals the folder in the tree (expands and shows the row), without changing the root',
    !!revealed && revealed.expanded && revealed.rowExists && revealed.sidebar && revealed.root === rootDir && revealed.active === demoPath,
    JSON.stringify(revealed)
  );

  const folderTarget = await js(`(function(){var p=activePane();return p?dirName(p.path):null;})()`);
  // suppressExplorer keeps a real Explorer window from opening: a loose window
  // would cover the app and ruin the layout measurements in the checks below.
  await js(`(function(){suppressExplorer=true;lastNoteFolderReveal=null;activePane().folderBtn.click();})()`);
  await sleep(200);
  const fired = await js('lastNoteFolderReveal');
  await js('suppressExplorer=false');
  check(
    'breadcrumb: the folder button fires fs:showInFolder on the note folder',
    !!fired && fired === folderTarget && folderTarget === rootDir,
    JSON.stringify({ fired, folderTarget })
  );

  // The pane with the deep note has to be the inactive one, with the root at
  // examples, so the path has the four segments that collapse into three.
  await js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(bcNote)};});if(p){setPaneDirty(p,false);closePane(p);}})()`);
  await sleep(400);
  await js(`void openPath(${JSON.stringify(bcDeepNote)}, true)`);
  await sleep(1000);
  await openPath(demoPath);
  await sleep(400);
  const deep = await js(
    `(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(bcDeepNote)};});if(!p)return null;if(p.el.classList.contains('collapsed'))return {collapsed:true};var segs=[...p.crumbEl.querySelectorAll('.crumb-seg')];var mid=segs[1];return {segs:segs.map(function(s){return s.textContent;}),seps:p.crumbEl.querySelectorAll('.crumb-sep').length,midTitle:mid?mid.title:null,root:treeRoot};})()`
  );
  check(
    'breadcrumb: a deep path collapses the middle (examples / … / deep) with a tooltip listing what was hidden',
    !!deep && !deep.collapsed && deep.segs.join('/') === 'examples/…/deep' && deep.seps === 2 && deep.midTitle === 'bc-e2e / mid' && deep.root === rootDir,
    JSON.stringify(deep)
  );

  await js('setSidebarVisible(false)');
  win.setSize(460, 840);
  await sleep(700);
  const overflow = await js(
    `(function(){var hs=[...document.querySelectorAll('#panes .pane:not(.collapsed) .pane-header')];var bad=hs.filter(function(h){return h.scrollWidth>h.clientWidth+1;}).map(function(h){return h.scrollWidth+'/'+h.clientWidth;});var tb=document.getElementById('titlebar');return {n:hs.length,bad:bad,titlebarOverflow:tb.scrollWidth>tb.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>window.innerWidth};})()`
  );
  check(
    'breadcrumb: the pane header does not overflow horizontally in a narrow window (scrollWidth == clientWidth)',
    !!overflow && overflow.n >= 1 && overflow.bad.length === 0 && !overflow.titlebarOverflow && !overflow.bodyOverflow,
    JSON.stringify(overflow)
  );

  win.setSize(1360, 840);
  await js('setSidebarVisible(true)');
  await forget(['bc-e2e', 'note-bc', 'note-deep']);
  await openPath(demoPath);
  fs.rmSync(bcDir, { recursive: true, force: true });
  await sleep(800);
}

module.exports = { run };
