// Editor groups: a tab bar that scrolls instead of wrapping, drag to split the
// view, drag between and within tab bars, a resizer the user drags (with a
// minimum width and the sizes persisted), the three group ceiling, and an
// emptied group collapsing into its neighbour.
//
// The drags are real DragEvents carrying a real DataTransfer, dispatched at
// coordinates read off the layout: the handlers are exercised through the same
// path the mouse takes.

// Dispatches dragstart on a pane's tab, then dragover and drop at `xFrac` of
// the target element. Returns what the drop hint said while hovering.
function dragTo(pathOrId, targetExpr, xFrac) {
  return (
    `(function(){` +
    `var p=panes.find(function(x){return x.path===${JSON.stringify(pathOrId)};});if(!p)return {error:'no pane'};` +
    `var dt=new DataTransfer();` +
    `p.tabEl.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));` +
    `var t=${targetExpr};var r=t.getBoundingClientRect();` +
    `var x=r.left+r.width*${xFrac};var y=r.top+r.height/2;` +
    `t.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientX:x,clientY:y,dataTransfer:dt}));` +
    `var hint=[...document.querySelectorAll('#panes .group')].map(function(g){return (g.classList.contains('drop-left')?'L':'')+(g.classList.contains('drop-right')?'R':'');}).join('')+` +
    `[...document.querySelectorAll('#panes .tab')].map(function(t){return (t.classList.contains('drop-before')?'B':'')+(t.classList.contains('drop-after')?'A':'');}).join('');` +
    `t.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientX:x,clientY:y,dataTransfer:dt}));` +
    `p.tabEl.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));` +
    `return {hint:hint,payload:dt.types.indexOf('application/x-wired-tab')!==-1};})()`
  );
}

const layout = `(function(){return {groups:groups.length,per:groups.map(function(g){return g.tabs.map(function(p){return p.path?p.path.split(/[\\\\/]/).pop():'untitled';});}),active:currentPath,resizers:document.querySelectorAll('#panes .group-resizer').length};})()`;

async function run(ctx) {
  const { js, sleep, check, fs, path, win, forget, openPath, readConfigFile, demoPath, rootDir } = ctx;

  win.setSize(1400, 860);
  await js('setSidebarVisible(false)');
  await sleep(500);

  const files = ['split-a-e2e.md', 'split-b-e2e.md', 'split-c-e2e.md'].map((n) => path.join(rootDir, n));
  files.forEach((f, i) => fs.writeFileSync(f, '# split ' + i + '\n', 'utf8'));
  await sleep(1300);
  await openPath(files[0]);
  await openPath(files[1]);
  await sleep(400);

  // 1. Three tabs in one group, on ONE row, scrolling rather than wrapping.
  const bar = await js(
    `(function(){var g=groups[0];var tabs=[...g.tabsEl.querySelectorAll('.tab')];var tops=[...new Set(tabs.map(function(t){return Math.round(t.getBoundingClientRect().top);}))];var cs=getComputedStyle(g.tabsEl);return {groups:groups.length,tabs:tabs.length,rows:tops.length,overflowX:cs.overflowX,wrap:cs.flexWrap,noVertical:g.tabsEl.scrollHeight<=g.tabsEl.clientHeight+1};})()`
  );
  check(
    'groups: every tab of a group sits on one scrolling row (no wrapping)',
    !!bar && bar.groups === 1 && bar.tabs === 3 && bar.rows === 1 && bar.overflowX === 'auto' && bar.wrap === 'nowrap' && bar.noVertical,
    JSON.stringify(bar)
  );

  // 2. Dragging a tab onto the RIGHT half of the editor area splits the view.
  const split = await js(dragTo(files[1], 'groups[0].bodyEl', 0.85));
  await sleep(600);
  const afterSplit = await js(layout);
  check(
    'groups: a tab dropped on the right half of the editor opens a second group beside it',
    !!split && split.payload && split.hint === 'R' && !!afterSplit && afterSplit.groups === 2 &&
      String(afterSplit.per[0]) === 'demo.md,split-a-e2e.md' && String(afterSplit.per[1]) === 'split-b-e2e.md' &&
      afterSplit.active === files[1] && afterSplit.resizers === 1,
    JSON.stringify({ split, afterSplit })
  );

  // 3. Dropping on another group's TAB BAR moves the tab there, at the position
  //    the pointer is over.
  const moved = await js(dragTo(files[0], 'groups[1].tabsEl', 0.02));
  await sleep(600);
  const afterMove = await js(layout);
  check(
    'groups: a tab dropped on another group tab bar moves there, at the drop position',
    !!moved && moved.hint === 'B' && !!afterMove && afterMove.groups === 2 &&
      String(afterMove.per[0]) === 'demo.md' && String(afterMove.per[1]) === 'split-a-e2e.md,split-b-e2e.md',
    JSON.stringify({ moved, afterMove })
  );

  // 4. Reordering inside one bar.
  await js(dragTo(files[0], 'groups[1].tabsEl', 0.99));
  await sleep(500);
  const reordered = await js(layout);
  check(
    'groups: dragging a tab inside its own bar reorders it',
    !!reordered && reordered.groups === 2 && String(reordered.per[1]) === 'split-b-e2e.md,split-a-e2e.md',
    JSON.stringify(reordered)
  );

  // 5. The resizer: dragging it moves the boundary, and the sizes reach
  //    config.json.
  const before = await js(`Math.round(groups[0].el.getBoundingClientRect().width)`);
  await js(
    `(function(){var r=document.querySelector('#panes .group-resizer');var b=r.getBoundingClientRect();var x=b.left+b.width/2,y=b.top+b.height/2;` +
    `r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:x,clientY:y}));` +
    `document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x+160,clientY:y}));` +
    `document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x+160,clientY:y}));})()`
  );
  await sleep(400);
  const after = await js(`Math.round(groups[0].el.getBoundingClientRect().width)`);
  // The layout is persisted through a debounce and an IPC write, so the file is
  // POLLED until it carries the new sizes instead of slept at and hoped for.
  let sizes = null;
  for (let i = 0; i < 20; i++) {
    const cfg = readConfigFile();
    sizes = cfg && cfg.session && cfg.session.groups ? cfg.session.groups.map((g) => g.size) : null;
    if (sizes && sizes.length === 2 && sizes[0] !== sizes[1]) break;
    await sleep(200);
  }
  check(
    'groups: dragging the resizer moves the boundary and the sizes are persisted',
    after - before >= 140 && after - before <= 180 && !!sizes && sizes.length === 2 && sizes[0] > sizes[1],
    JSON.stringify({ before, after, sizes })
  );

  // 6. A group cannot be squeezed below its minimum.
  await js(
    `(function(){var r=document.querySelector('#panes .group-resizer');var b=r.getBoundingClientRect();var x=b.left+b.width/2,y=b.top+b.height/2;` +
    `r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:x,clientY:y}));` +
    `document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x-2000,clientY:y}));` +
    `document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x-2000,clientY:y}));})()`
  );
  await sleep(500);
  const clamped = await js(
    `(function(){return groups.map(function(g){return Math.round(g.el.getBoundingClientRect().width);});})()`
  );
  check(
    'groups: a group never shrinks below its minimum width, however far the resizer is dragged',
    Array.isArray(clamped) && clamped.every((w) => w >= 259),
    JSON.stringify(clamped)
  );

  // 7. Three groups is the ceiling: a fourth split moves the tab into the group
  //    already on that side instead of opening one more.
  await openPath(files[2]);
  await sleep(400);
  await js(dragTo(files[2], 'groups[1].bodyEl', 0.9));
  await sleep(600);
  const three = await js(layout);
  const capped = await js(dragTo(files[1], 'groups[0].bodyEl', 0.1));
  await sleep(600);
  const afterCap = await js(layout);
  check(
    'groups: three side by side is the ceiling, and a further split moves the tab into the group on that side',
    !!three && three.groups === 3 && !!capped && capped.hint === 'L' && !!afterCap && afterCap.groups === 3 &&
      String(afterCap.per[0]) === 'demo.md,split-b-e2e.md' && String(afterCap.per[2]) === 'split-c-e2e.md',
    JSON.stringify({ three, afterCap })
  );

  // 8. Emptying a group collapses it and hands the width to the neighbour.
  const widthsBefore = await js(`groups.map(function(g){return Math.round(g.el.getBoundingClientRect().width);})`);
  await js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(files[2])};});setPaneDirty(p,false);closePane(p);})()`);
  await sleep(700);
  const collapsed = await js(layout);
  const widthsAfter = await js(`groups.map(function(g){return Math.round(g.el.getBoundingClientRect().width);})`);
  check(
    'groups: closing the last tab of a group collapses it and its width goes to the neighbour',
    !!collapsed && collapsed.groups === 2 && collapsed.resizers === 1 &&
      Array.isArray(widthsAfter) && widthsAfter.length === 2 &&
      widthsAfter[1] > widthsBefore[1],
    JSON.stringify({ widthsBefore, widthsAfter, collapsed })
  );

  await forget(['split-a-e2e', 'split-b-e2e', 'split-c-e2e']);
  await sleep(500);
  const back = await js(layout);
  check(
    'groups: with every extra tab closed the layout is back to one group holding demo.md',
    !!back && back.groups === 1 && String(back.per[0]) === 'demo.md' && back.active === demoPath,
    JSON.stringify(back)
  );

  files.forEach((f) => fs.rmSync(f, { force: true }));
  await js('setSidebarVisible(true)');
  win.setSize(1360, 840);
  await sleep(800);
}

module.exports = { run };
