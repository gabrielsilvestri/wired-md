// Real sliding panes: in a narrow window the inactive panes collapse into a
// 40px spine with a vertical title, clicking a spine expands that pane, and a
// window resize recomputes the whole layout.

async function run(ctx) {
  const { js, sleep, check, fs, path, win, forget, rootDir } = ctx;

  win.setSize(700, 840);
  await sleep(500);
  const spineA = path.join(rootDir, 'spine-a-e2e.md');
  const spineB = path.join(rootDir, 'spine-b-e2e.md');
  fs.writeFileSync(spineA, '# spine a\n', 'utf8');
  fs.writeFileSync(spineB, '# spine b\n', 'utf8');
  await sleep(1200);
  await js(`void openPath(${JSON.stringify(spineA)}, true)`);
  await sleep(800);
  await js(`void openPath(${JSON.stringify(spineB)}, true)`);
  await sleep(1000);

  const spines = await js(
    `(function(){var all=[...document.querySelectorAll('#panes .pane')];var col=all.filter(function(p){return p.classList.contains('collapsed');});var active=document.querySelector('#panes .pane.active');var sp=col[0]?col[0].querySelector('.pane-spine'):null;var t=sp?sp.querySelector('.spine-title'):null;return {n:all.length,col:col.length,activeOpen:!!active&&!active.classList.contains('collapsed'),spineWidth:col[0]?Math.round(col[0].getBoundingClientRect().width):0,vertical:t?getComputedStyle(t).writingMode:null,title:t?t.textContent:null,closeOnTop:sp?!!sp.querySelector('.spine-close'):false,dot:sp?!!sp.querySelector('.spine-dot'):false};})()`
  );
  check(
    'spine: a narrow window collapses the inactive panes with a vertical title, an X and the dirty dot',
    !!spines && spines.n === 3 && spines.col === 2 && spines.activeOpen && spines.spineWidth === 40 && spines.vertical === 'vertical-rl' && !!spines.title && spines.closeOnTop && spines.dot,
    JSON.stringify(spines)
  );

  await js(
    `(function(){var all=[...document.querySelectorAll('#panes .pane')];var target=all.find(function(p){return p.classList.contains('collapsed')&&p.querySelector('.spine-title').textContent==='spine-a-e2e.md';});if(target)target.querySelector('.pane-spine').dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`
  );
  await sleep(700);
  const expanded = await js(
    `(function(){var active=document.querySelector('#panes .pane.active');var col=document.querySelectorAll('#panes .pane.collapsed').length;return {active:currentPath,open:!!active&&!active.classList.contains('collapsed'),col:col};})()`
  );
  check(
    'clicking a spine expands that pane and shrinks the previous one',
    !!expanded && expanded.active === spineA && expanded.open && expanded.col === 2,
    JSON.stringify(expanded)
  );

  // The sidebar is hidden first so the ruler is only the pane strip.
  await js('setSidebarVisible(false)');
  win.setSize(1500, 840);
  await sleep(700);
  const wide = await js(`document.querySelectorAll('#panes .pane.collapsed').length`);
  win.setSize(700, 840);
  await sleep(700);
  const narrow = await js(`document.querySelectorAll('#panes .pane.collapsed').length`);
  await js('setSidebarVisible(true)');
  check('resize recomputes: 1500px opens all 3 panes, 700px collapses 2', wide === 0 && narrow === 2, 'wide=' + wide + ' narrow=' + narrow);

  await forget(['spine-a-e2e', 'spine-b-e2e']);
  fs.rmSync(spineA, { force: true });
  fs.rmSync(spineB, { force: true });
  await sleep(800);
}

module.exports = { run };
