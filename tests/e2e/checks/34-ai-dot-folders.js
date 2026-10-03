// Dot folders where agent instructions live (.claude and its siblings) show in
// the tree and are searched; every other dot folder stays hidden from both.

async function run(ctx) {
  const { js, check, fs, path, userDir, openPath, until, demoPath } = ctx;

  const root = userDir('dots-check');
  const w = (rel, text) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
    return p;
  };
  const claude = w('CLAUDE.md', '# Project\n\nSee the agents.\n');
  const agent = w('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: reviews\n---\n\nquokkaword lives here\n');
  w('.claude/commands/ship.md', '---\ndescription: ship it\n---\n\nShip $ARGUMENTS\n');
  w('.vscode/notes.md', '# hidden\n\nquokkaword must not be found here\n');
  // A Claude Code worktree is a whole copy of the repository, not notes.
  w('.claude/worktrees/wf-1/CLAUDE.md', '# a copy\n\nquokkaword in a worktree copy\n');

  try {
    await openPath(claude);
    await until(`treeRoot===${JSON.stringify(root)}`);
    const folders = await until(`(function(){var t=[...document.querySelectorAll('#file-tree .tree-row.folder')].map(function(r){return r.title;});return t.length?t:null;})()`);
    check(
      'dot folders: .claude shows in the tree, another dot folder and .claude/worktrees do not',
      !!folders && folders.includes(path.join(root, '.claude')) && !folders.some((f) => f.indexOf('.vscode') !== -1 || f.indexOf('worktrees') !== -1),
      JSON.stringify(folders)
    );

    await js(`(function(){openSearch();var i=document.getElementById('search-input');i.value='quokkaword';i.dispatchEvent(new Event('input'));})()`);
    await until(`/results? in|no results/i.test(document.getElementById('search-status').textContent)`);
    const hits = await js(`searchHits.map(function(h){return h.path;})`);
    await js(`document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    check(
      'dot folders: full text search finds a note inside .claude and skips other dot folders',
      hits.includes(agent) && !hits.some((h) => h.indexOf('.vscode') !== -1 || h.indexOf('worktrees') !== -1),
      JSON.stringify(hits)
    );
  } finally {
    await js(`[...panes].filter(function(x){return x.path&&x.path.indexOf('dots-check')!==-1;}).forEach(function(x){setPaneDirty(x,false);closePane(x);})`);
    await openPath(demoPath);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { run };
