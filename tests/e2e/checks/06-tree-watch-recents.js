// A folder created on disk shows up through fs.watch, starts closed, expands on
// click, and opening the note inside puts it on top of Recents.

async function run(ctx) {
  const { js, sleep, check, fs, path, forget, openPath, demoPath, rootDir } = ctx;

  const subDir = path.join(rootDir, 'sub-e2e');
  const subFile = path.join(subDir, 'note-e2e.md');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(subFile, '# note e2e\n', 'utf8');
  await sleep(1500);

  const folderInTree = await js(
    `(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.folder .tree-name')];return rows.some(function(n){return n.textContent==='sub-e2e';});})()`
  );
  const noteHidden = await js(
    `(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file .tree-name')];return !rows.some(function(n){return n.textContent==='note-e2e.md'&&n.closest('.tree-children').style.display!=='none';});})()`
  );
  await js(
    `(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.folder')];var r=rows.find(function(x){return x.querySelector('.tree-name').textContent==='sub-e2e';});if(r)r.click();})()`
  );
  await sleep(300);
  const noteVisible = await js(
    `(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file .tree-name')];var n=rows.find(function(x){return x.textContent==='note-e2e.md';});return !!n && n.closest('.tree-children').style.display!=='none';})()`
  );
  check(
    'tree: new folder via fs.watch, closed by default, expands on click',
    folderInTree && noteHidden && noteVisible,
    'folder=' + folderInTree + ' hidden=' + noteHidden + ' visible=' + noteVisible
  );

  await js(
    `(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file .tree-name')];var n=rows.find(function(x){return x.textContent==='note-e2e.md';});if(n)n.closest('.tree-row').click();})()`
  );
  await sleep(600);
  const recents = await js(`(function(){return [...document.querySelectorAll('#recent-list li')].map(function(l){return l.textContent;});})()`);
  check(
    'recents: the note just opened is on top and demo.md is in the list',
    Array.isArray(recents) && recents[0] === 'note-e2e.md' && recents.includes('demo.md'),
    JSON.stringify(recents)
  );

  await openPath(demoPath);
  fs.rmSync(subDir, { recursive: true, force: true });
  await forget(['note-e2e']);
  await sleep(600);
}

module.exports = { run };
