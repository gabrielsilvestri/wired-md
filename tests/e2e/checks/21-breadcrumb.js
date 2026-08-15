// Breadcrumb in the pane header: the Explorer button FIRST, then the folder
// trail (dim, chevron separated, each segment carrying its full path) and the
// file at the end in full ink with its own icon. Plus the clickable segments,
// the middle collapse on a deep path, and no horizontal overflow when the
// window is narrow.

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
  // subfolder and then going back to demo.md puts the root back at examples, so
  // the other tab shows a two segment relative path.
  await openPath(bcNote);
  await sleep(400);
  await openPath(demoPath);
  await sleep(900);

  // 1. Order in the header, and the shape of the trail.
  const crumbs = await js(
    `(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(bcNote)};});if(!p)return null;` +
    `var h=p.el.querySelector('.pane-header');var kids=[...h.children].map(function(k){return k.className.split(' ')[0];});` +
    `var segs=[...p.crumbEl.querySelectorAll('.crumb-seg')];` +
    `var seps=[...p.crumbEl.querySelectorAll('.crumb-sep')];` +
    `var file=p.crumbEl.querySelector('.crumb-file');` +
    `return {order:kids,segs:segs.map(function(s){return s.textContent;}),tips:segs.map(function(s){return s.title;}),` +
    `seps:seps.length,sepIsIcon:seps.every(function(s){return !!s.querySelector('svg')&&s.textContent==='';}),` +
    `file:file?file.querySelector('.crumb-file-name').textContent:null,fileIcon:!!(file&&file.querySelector('svg')),` +
    `fileTip:file?file.title:null,clickable:segs.map(function(s){return s.classList.contains('clickable');}),` +
    `folderBtn:!!p.folderBtn.querySelector('svg')&&(p.folderBtn.title||'').length>0&&p.folderBtn.style.display!=='none',` +
    `root:treeRoot};})()`
  );
  check(
    'breadcrumb: the Explorer button comes first, then the folder trail (examples > bc-e2e) with chevrons, then the file',
    !!crumbs && crumbs.order[0] === 'pane-folder' && crumbs.order[1] === 'pane-crumbs' &&
      crumbs.segs.join('/') === 'examples/bc-e2e' && crumbs.seps === 2 && crumbs.sepIsIcon &&
      crumbs.file === 'note-bc.md' && crumbs.fileIcon && crumbs.fileTip === bcNote &&
      crumbs.tips.join('|') === rootDir + '|' + bcDir &&
      crumbs.clickable.every(Boolean) && crumbs.folderBtn && crumbs.root === rootDir,
    JSON.stringify(crumbs)
  );

  // 2. Folder and file are not the same kind of thing at a glance, and both
  //    inks are inside the contrast band the maintainer reads in.
  const inks = await js(
    `(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(bcNote)};});` +
    `var seg=getComputedStyle(p.crumbEl.querySelector('.crumb-seg')).color;` +
    `var file=getComputedStyle(p.crumbEl.querySelector('.crumb-file')).color;` +
    `var bg=getComputedStyle(p.el.querySelector('.pane-header')).backgroundColor;` +
    `var rgb=function(s){var m=String(s).match(/[\\d.]+/g);return [Number(m[0]),Number(m[1]),Number(m[2])];};` +
    `return {seg:seg,file:file,segRatio:contrastRatio(rgb(seg),rgb(bg)),fileRatio:contrastRatio(rgb(file),rgb(bg))};})()`
  );
  check(
    'breadcrumb: the folder segments are dimmer than the file name, and both stay between 4.5:1 and 11:1',
    !!inks && inks.seg !== inks.file && inks.segRatio >= 4.5 && inks.segRatio <= 11 &&
      inks.fileRatio >= 4.5 && inks.fileRatio <= 11 && inks.fileRatio > inks.segRatio,
    JSON.stringify(inks)
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

  // A deep path collapses in the middle, with the hidden folders in a tooltip.
  await js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(bcNote)};});if(p){setPaneDirty(p,false);closePane(p);}})()`);
  await sleep(400);
  await openPath(bcDeepNote);
  await sleep(700);
  await openPath(demoPath);
  await sleep(700);
  const deep = await js(
    `(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(bcDeepNote)};});if(!p)return null;` +
    `var segs=[...p.crumbEl.querySelectorAll('.crumb-seg')];var mid=segs[1];` +
    `return {segs:segs.map(function(s){return s.textContent;}),seps:p.crumbEl.querySelectorAll('.crumb-sep').length,` +
    `midTitle:mid?mid.title:null,file:p.crumbEl.querySelector('.crumb-file-name').textContent,root:treeRoot};})()`
  );
  check(
    'breadcrumb: a deep path collapses the middle (examples > … > deep) with a tooltip listing what was hidden',
    !!deep && deep.segs.join('/') === 'examples/…/deep' && deep.seps === 3 && deep.midTitle === 'bc-e2e / mid' &&
      deep.file === 'note-deep.md' && deep.root === rootDir,
    JSON.stringify(deep)
  );

  await js('setSidebarVisible(false)');
  win.setSize(460, 840);
  await sleep(700);
  const overflow = await js(
    `(function(){var hs=[...document.querySelectorAll('#panes .pane.current .pane-header')];var bad=hs.filter(function(h){return h.scrollWidth>h.clientWidth+1;}).map(function(h){return h.scrollWidth+'/'+h.clientWidth;});var bars=[...document.querySelectorAll('#panes .tab-bar')];var tb=document.getElementById('titlebar');return {n:hs.length,bad:bad,barScrolls:bars.every(function(b){return b.scrollHeight<=b.clientHeight+1;}),titlebarOverflow:tb.scrollWidth>tb.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>window.innerWidth};})()`
  );
  check(
    'breadcrumb: neither the pane header nor the tab bar overflows in a narrow window',
    !!overflow && overflow.n >= 1 && overflow.bad.length === 0 && overflow.barScrolls &&
      !overflow.titlebarOverflow && !overflow.bodyOverflow,
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
