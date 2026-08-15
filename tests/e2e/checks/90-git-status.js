// Git badges on the tree row and in the pane header.
//
// The suite runs INSIDE the wired-md repository, so this check is careful to
// leave zero residue: the untracked file it creates is deleted and the tracked
// file it touches is restored byte for byte, both before the last assertion.

async function run(ctx) {
  const { js, check, sleep, fs, path, rootDir, demoPath } = ctx;

  const untracked = path.join(rootDir, 'git-badge-e2e.md');
  const demoBefore = fs.readFileSync(demoPath, 'utf8');

  // Row state for a file, read off the rendered tree.
  const badgeOf = (needle) =>
    js(
      `(function(){var rows=[].slice.call(document.querySelectorAll('#file-tree .tree-row.file'));` +
        `var r=rows.filter(function(x){return x.title.indexOf(${JSON.stringify(needle)})!==-1;})[0];` +
        `if(!r)return {row:false};var b=r.querySelector('.git-badge');` +
        `return {row:true,letter:b?b.textContent:null,tip:b?b.title:null,slot:!!r.querySelector('.git-slot')};})()`
    );

  const refresh = async () => {
    await js('void refreshSidebar()');
    await sleep(300);
    await js('void gitRefresh()');
    await sleep(900);
  };

  // `git status` is a spawn, so how long it takes depends on the machine and on
  // what else the app is doing right then. The badge is POLLED until it says
  // what the tree on disk says, instead of slept at for a fixed amount and hoped
  // for (the same trap the terminal check fell into).
  const waitBadge = async (needle, letter) => {
    let seen = null;
    for (let i = 0; i < 25; i++) {
      seen = await badgeOf(needle);
      if (seen && ((seen.row && seen.letter === letter) || (!seen.row && letter === null))) return seen;
      await sleep(300);
      if (i % 3 === 2) await js('void gitRefresh()');
    }
    return seen;
  };

  // A new .md inside the repo is untracked.
  fs.writeFileSync(untracked, '# git badge e2e\n\nA file the suite created.\n', 'utf8');
  // A tracked file the suite modifies.
  fs.writeFileSync(demoPath, demoBefore + '\nline added by the git e2e\n', 'utf8');
  await refresh();

  const repo = await js('gitRepoRoot');
  const fresh = await waitBadge('git-badge-e2e.md', '?');
  const modified = await waitBadge('demo.md', 'M');

  check(
    'git: the tree row of a new file carries the untracked badge and the row of a modified file carries M',
    !!repo && !!fresh && fresh.row && fresh.letter === '?' && !!modified && modified.letter === 'M',
    JSON.stringify({ repo: !!repo, fresh, modified })
  );

  // An earlier check left another file in the active pane: the header assertion
  // is about the note that was just modified, so put it there first.
  await ctx.openPath(demoPath);
  await refresh();
  // Same wait for the badge inside the pane header.
  for (let i = 0; i < 25; i++) {
    const got = await js(`(function(){var h=activePane().el.querySelector('.pane-header .git-badge');return h?h.textContent:null;})()`);
    if (got === 'M') break;
    await sleep(300);
    if (i % 3 === 2) await js('void gitRefresh()');
  }
  const header = await js(
    `(function(){var p=activePane();var h=p.el.querySelector('.pane-header');var b=h.querySelector('.git-badge');` +
      `var d=h.querySelector('.pane-diff');` +
      `return {path:p.path,letter:b?b.textContent:null,diffVisible:!!d&&d.style.display!=='none',diffTip:d?d.title:null};})()`
  );
  check(
    'git: the pane header of the modified note shows the same badge and reveals the diff icon',
    !!header && /demo\.md$/.test(header.path || '') && header.letter === 'M' && header.diffVisible && (header.diffTip || '').length > 0,
    JSON.stringify(header)
  );

  // Back to a clean tree: the file goes away and the note is restored.
  fs.unlinkSync(untracked);
  fs.writeFileSync(demoPath, demoBefore, 'utf8');
  await refresh();

  const afterFresh = await waitBadge('git-badge-e2e.md', null);
  const afterDemo = await waitBadge('demo.md', null);
  check(
    'git: with the repository clean again, both badges are gone and no residue is left behind',
    !fs.existsSync(untracked) && fs.readFileSync(demoPath, 'utf8') === demoBefore &&
      afterFresh.row === false && afterDemo.row === true && afterDemo.letter === null && afterDemo.slot === true,
    JSON.stringify({ afterFresh, afterDemo })
  );
}

module.exports = { run };
