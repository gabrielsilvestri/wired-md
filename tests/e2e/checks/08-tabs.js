// Tabs: a file opens in a tab of the active group, "open beside" puts it in a
// second group, a file already open is focused instead of opened twice, the
// dirty dot rides the tab, and closing works from the X, the middle button and
// Ctrl+W.

async function run(ctx) {
  const { js, key, sleep, check, fs, path, rootDir, demoPath } = ctx;

  const paneFile = path.join(rootDir, 'pane-e2e.md');
  fs.writeFileSync(paneFile, '# pane e2e note\n\ntest text.\n', 'utf8');
  await sleep(1200); // fs.watch refreshes the tree (and the quick switcher)

  // 1. The boot file is a tab, not a nameless pane.
  const first = await js(
    `(function(){var g=groups[0];var t=g.tabsEl.querySelectorAll('.tab');var a=g.tabsEl.querySelector('.tab.active');return {groups:groups.length,panes:panes.length,tabs:t.length,label:a?a.querySelector('.tab-label').textContent:null,tip:a?a.title:null,plus:!!g.tabsEl.querySelector('.tab-new svg'),plusTip:(g.tabsEl.querySelector('.tab-new')||{}).title};})()`
  );
  check(
    'tabs: the open file is a tab in the only group, with the file name, the path in the tooltip and a new file button',
    !!first && first.groups === 1 && first.panes === 1 && first.tabs === 1 && first.label === 'demo.md' &&
      first.tip === demoPath && first.plus && (first.plusTip || '').length > 0,
    JSON.stringify(first)
  );

  // 2. Open beside: a second group with its own tab bar.
  await js(`void openPath(${JSON.stringify(paneFile)}, true)`);
  await sleep(1500);
  const beside = await js(
    `(function(){var a=document.querySelector('#panes .pane.active');var lab=activePane().titleEl;return {groups:groups.length,panes:panes.length,active:currentPath,label:lab?lab.textContent:null,perGroup:groups.map(function(g){return g.tabs.length;}),resizer:document.querySelectorAll('#panes .group-resizer').length,current:!!a&&a.classList.contains('current')};})()`
  );
  check(
    'tabs: "open beside" creates a second group with one tab, separated by a resizer',
    !!beside && beside.groups === 2 && beside.panes === 2 && beside.active === paneFile &&
      beside.label === 'pane-e2e.md' && String(beside.perGroup) === '1,1' && beside.resizer === 1 && beside.current,
    JSON.stringify(beside)
  );

  // 3. A file already open anywhere focuses its tab instead of opening twice.
  await js(`void openPath(${JSON.stringify(demoPath)}, false)`);
  await sleep(700);
  const focused = await js(
    `(function(){return {panes:panes.length,active:currentPath,activeGroupTabs:activeGroup().tabs.length};})()`
  );
  check(
    'tabs: opening a file that is already open focuses its tab (no duplicate)',
    !!focused && focused.panes === 2 && focused.active === demoPath && focused.activeGroupTabs === 1,
    JSON.stringify(focused)
  );

  // 4. A second file in the SAME group is a second tab, and the active one is
  //    visually distinct (page surface, full ink, accent rule on top).
  const tabFile = path.join(rootDir, 'tab-e2e.md');
  fs.writeFileSync(tabFile, '# tab e2e\n', 'utf8');
  await sleep(1200);
  await js(`void openPath(${JSON.stringify(tabFile)}, false)`);
  await sleep(1200);
  const twoTabs = await js(
    `(function(){var g=activeGroup();var tabs=[...g.tabsEl.querySelectorAll('.tab')];var on=g.tabsEl.querySelector('.tab.active');var off=tabs.find(function(t){return !t.classList.contains('active');});` +
    `var cs=getComputedStyle(on),co=getComputedStyle(off);` +
    `var ink=getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();` +
    `return {tabs:tabs.length,labels:tabs.map(function(t){return t.querySelector('.tab-label').textContent;}),` +
    `activeBg:cs.backgroundColor,idleBg:co.backgroundColor,activeInk:cs.color,ink:ink,shadow:cs.boxShadow,` +
    `visible:panes.filter(function(p){return p.groupId===g.id&&p.el.classList.contains('current');}).length,` +
    `selected:on.getAttribute('aria-selected'),role:g.tabsEl.getAttribute('role')};})()`
  );
  check(
    'tabs: a second file in the same group is a second tab, only one is current, and the active tab is clearly distinct',
    !!twoTabs && twoTabs.tabs === 2 && twoTabs.labels.join(',') === 'demo.md,tab-e2e.md' &&
      twoTabs.activeBg !== twoTabs.idleBg && twoTabs.visible === 1 &&
      twoTabs.selected === 'true' && twoTabs.role === 'tablist' && twoTabs.shadow !== 'none',
    JSON.stringify(twoTabs)
  );

  // 5. The dirty dot lives on the tab.
  await js(`(function(){setPaneDirty(activePane(),true);})()`);
  await sleep(200);
  const dirtyTab = await js(
    `(function(){var t=activePane().tabEl;var d=t.querySelector('.tab-dot');var cs=getComputedStyle(d);var amber=getComputedStyle(document.documentElement).getPropertyValue('--amber').trim();return {cls:t.classList.contains('dirty'),bg:cs.backgroundColor,amber:amber,scale:cs.transform,aria:d.getAttribute('aria-label')};})()`
  );
  await js(`(function(){setPaneDirty(activePane(),false);})()`);
  check(
    'tabs: an unsaved tab carries the amber dot, with words for the screen reader',
    !!dirtyTab && dirtyTab.cls && dirtyTab.bg !== 'rgba(0, 0, 0, 0)' && dirtyTab.aria === 'Unsaved changes',
    JSON.stringify(dirtyTab)
  );

  // 6. The X on the tab closes it; the group falls back to its other tab.
  await js(`activePane().tabEl.querySelector('.tab-close').click()`);
  await sleep(700);
  const closedByX = await js(`(function(){return {panes:panes.length,active:currentPath,tabs:activeGroup().tabs.length};})()`);
  check(
    'tabs: the X on the tab closes it and the group falls back to its other tab',
    !!closedByX && closedByX.panes === 2 && closedByX.active === demoPath && closedByX.tabs === 1,
    JSON.stringify(closedByX)
  );

  // 7. Middle click closes too (the tab bar contract everywhere else).
  await js(`void openPath(${JSON.stringify(tabFile)}, false)`);
  await sleep(1200);
  await js(
    `(function(){var t=activePane().tabEl;t.dispatchEvent(new MouseEvent('auxclick',{button:1,bubbles:true,cancelable:true}));})()`
  );
  await sleep(600);
  const closedByMiddle = await js(`(function(){return {panes:panes.length,active:currentPath};})()`);
  check(
    'tabs: middle click closes a tab',
    !!closedByMiddle && closedByMiddle.panes === 2 && closedByMiddle.active === demoPath,
    JSON.stringify(closedByMiddle)
  );

  // 8. Ctrl+W closes the active tab, which empties the second group and gives
  //    its width back to the neighbour.
  await js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(paneFile)};});setActivePane(p);})()`);
  await sleep(400);
  key('W', ['control']);
  await sleep(800);
  const afterCtrlW = await js(
    `(function(){return {panes:panes.length,groups:groups.length,active:currentPath,resizer:document.querySelectorAll('#panes .group-resizer').length,` +
    `fills:Math.abs(groups[0].el.getBoundingClientRect().width-document.getElementById('panes').clientWidth)<=2};})()`
  );
  check(
    'tabs: Ctrl+W closes the active tab, the emptied group collapses and the neighbour takes its width',
    !!afterCtrlW && afterCtrlW.panes === 1 && afterCtrlW.groups === 1 && afterCtrlW.active === demoPath &&
      afterCtrlW.resizer === 0 && afterCtrlW.fills,
    JSON.stringify(afterCtrlW)
  );

  fs.rmSync(tabFile, { force: true });
  await js(`(function(){config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('tab-e2e')===-1;});saveConfig();renderRecents();})()`);
  await sleep(600);

  // pane-e2e.md stays on disk: the quick switcher check right after needs it.
  ctx.state.paneFile = paneFile;
}

module.exports = { run };
