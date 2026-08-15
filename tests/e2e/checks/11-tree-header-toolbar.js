// Sidebar header (root name, tooltip, Explorer button), tree toolbar, the name
// filter, creating a file from the toolbar, the context menu rename, and the
// sort order persisted to config.json.

async function run(ctx) {
  const { js, sleep, check, fs, path, forget, openPath, readConfigFile, demoPath, rootDir } = ctx;

  const header = await js(
    `(function(){var n=document.getElementById('sidebar-root-name');var p=document.getElementById('sidebar-root-path');var b=document.getElementById('btn-root-explorer');` +
    `var cs=n?getComputedStyle(n):null;var ps=p?getComputedStyle(p):null;` +
    `return {name:n?n.textContent:null,tip:n?n.title:null,path:p?p.textContent:null,pathTip:p?p.title:null,` +
    `nowrap:!!ps&&ps.whiteSpace==='nowrap',dimmer:!!cs&&!!ps&&cs.color!==ps.color,` +
    `btn:!!b&&!!b.querySelector('svg')&&(b.title||'').length>0};})()`
  );
  const parentDir = path.dirname(rootDir);
  check(
    'sidebar header: root name, the parent path under it (dimmed, single line, full path in the tooltip) and the Explorer button',
    !!header && header.name === path.basename(rootDir) && header.tip === rootDir &&
      header.path && parentDir.endsWith(header.path.split('…').pop()) && header.pathTip === rootDir &&
      header.nowrap && header.dimmer && header.btn,
    JSON.stringify(header)
  );

  const toolbar = await js(
    `(function(){return ['btn-tree-new-file','btn-tree-template','btn-tree-new-folder','btn-tree-sort','btn-tree-collapse','btn-tree-search'].every(function(id){var b=document.getElementById(id);return !!b&&!!b.querySelector('svg')&&(b.title||'').length>0;});})()`
  );
  check('tree toolbar: new .md, template, new folder, sort, collapse all, filter', toolbar === true, String(toolbar));

  await js(`(function(){toggleTreeSearch(true);var i=document.getElementById('tree-search');i.value='note';i.dispatchEvent(new Event('input'));})()`);
  await sleep(250);
  const filtered = await js(
    `(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file .tree-name')].map(function(n){return n.textContent;});return {rows:rows,onlyNotes:rows.length>=1&&rows.every(function(n){return n.toLowerCase().indexOf('note')!==-1;})};})()`
  );
  await js(`document.getElementById('tree-search').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(250);
  const cleared = await js(
    `(function(){var rows=document.querySelectorAll('#file-tree .tree-row.file').length;return {hidden:document.getElementById('tree-search-wrap').classList.contains('hidden'),rows:rows};})()`
  );
  check(
    'tree filter narrows by name and Esc clears it',
    !!filtered && filtered.onlyNotes && !!cleared && cleared.hidden && cleared.rows > filtered.rows.length,
    JSON.stringify({ filtered, cleared })
  );

  const newPath = path.join(rootDir, 'new-e2e.md');
  await js('selectedDir = null'); // an earlier click pointed at a folder already deleted
  await js(`document.getElementById('btn-tree-new-file').click()`);
  await sleep(300);
  const dialogOpen = await js(`(function(){return !document.getElementById('input-overlay').classList.contains('hidden');})()`);
  await js(`(function(){var i=document.getElementById('input-field');i.value='new-e2e.md';document.getElementById('input-ok').click();})()`);
  await sleep(900);
  const created = await js('currentPath');
  check('toolbar creates a .md and opens it', dialogOpen === true && fs.existsSync(newPath) && created === newPath, JSON.stringify({ dialogOpen, created }));

  await js(
    `(function(){var rows=[...document.querySelectorAll('#file-tree .tree-row.file')];var r=rows.find(function(x){return x.querySelector('.tree-name').textContent==='new-e2e.md';});if(r)r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));})()`
  );
  await sleep(250);
  const menu = await js(
    `(function(){var m=document.getElementById('ctx-menu');if(m.classList.contains('hidden'))return null;return [...m.querySelectorAll('.ctx-item')].map(function(i){return i.textContent;});})()`
  );
  await js(`(function(){var it=[...document.querySelectorAll('#ctx-menu .ctx-item')].find(function(i){return i.textContent==='rename';});if(it)it.click();})()`);
  await sleep(300);
  await js(`(function(){var i=document.getElementById('input-field');i.value='renamed-e2e.md';document.getElementById('input-ok').click();})()`);
  await sleep(900);
  const renamedPath = path.join(rootDir, 'renamed-e2e.md');
  const renamed = fs.existsSync(renamedPath) && !fs.existsSync(newPath);
  const panePath = await js('currentPath');
  check(
    'context menu opens and renames the file',
    Array.isArray(menu) && menu.includes('rename') && menu.includes('delete (recycle bin)') && renamed && panePath === renamedPath,
    JSON.stringify({ menu, renamed, panePath })
  );

  await openPath(demoPath);
  fs.rmSync(renamedPath, { force: true });
  await forget(['new-e2e', 'renamed-e2e']);
  await sleep(600);

  // Reading state out of config.json means resetting it first: the user's real
  // config can carry any sort order.
  await js(`setTreeSort('az')`);
  await sleep(300);
  await js(`(function(){document.getElementById('btn-tree-sort').click();})()`);
  await sleep(250);
  await js(`(function(){var it=[...document.querySelectorAll('#ctx-menu .ctx-item')].find(function(i){return i.textContent==='modified first';});if(it)it.click();})()`);
  await sleep(500);
  const onDisk = readConfigFile();
  const sortCfg = await js('config.treeSort');
  await js(`setTreeSort('az')`);
  await sleep(300);
  check(
    'sort order changes from the menu and persists to config.json',
    sortCfg === 'recent' && !!onDisk && onDisk.treeSort === 'recent',
    JSON.stringify({ sortCfg, disk: onDisk && onDisk.treeSort })
  );
}

module.exports = { run };
