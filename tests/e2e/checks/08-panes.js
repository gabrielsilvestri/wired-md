// Sliding panes: a second file opens beside and takes focus; closing it goes
// back to a single pane with demo.md active.

async function run(ctx) {
  const { js, sleep, check, fs, path, demoPath, rootDir } = ctx;

  const paneFile = path.join(rootDir, 'pane-e2e.md');
  fs.writeFileSync(paneFile, '# pane e2e note\n\ntest text.\n', 'utf8');
  await sleep(1200); // fs.watch refreshes the tree (and the quick switcher)
  await js(`void openPath(${JSON.stringify(paneFile)}, true)`);
  await sleep(1500);

  const two = await js(
    `(function(){var t=document.querySelector('#panes .pane.active .pane-title');return {n:panes.length,dom:document.querySelectorAll('#panes .pane').length,active:currentPath,title:t?t.textContent:null,single:document.getElementById('panes').classList.contains('single')};})()`
  );
  check(
    'panes: the second pane opens beside and becomes active',
    !!two && two.n === 2 && two.dom === 2 && two.active === paneFile && two.title === 'pane-e2e.md' && !two.single,
    JSON.stringify(two)
  );

  await js(`document.querySelector('#panes .pane.active .pane-close').click()`);
  await sleep(600);
  const one = await js(
    `(function(){return {n:panes.length,dom:document.querySelectorAll('#panes .pane').length,active:currentPath,single:document.getElementById('panes').classList.contains('single')};})()`
  );
  check(
    'panes: closing goes back to one pane with demo.md active',
    !!one && one.n === 1 && one.dom === 1 && one.active === demoPath && one.single,
    JSON.stringify(one)
  );

  // pane-e2e.md stays on disk: the quick switcher check right after needs it.
  ctx.state.paneFile = paneFile;
}

module.exports = { run };
