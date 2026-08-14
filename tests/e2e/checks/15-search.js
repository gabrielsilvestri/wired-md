// Full text search across the folder (Ctrl+Shift+F): the overlay, the grouped
// results with counts, the highlighted snippet, keyboard navigation, and Esc.

async function run(ctx) {
  const { js, key, sleep, check, fs, path, forget, openPath, demoPath, rootDir } = ctx;

  const fileA = path.join(rootDir, 'search-a-e2e.md');
  const fileB = path.join(rootDir, 'search-b-e2e.md');
  fs.writeFileSync(fileA, '# search a\n\na line with zebrafone here\n\nanother with zebrafone again\n', 'utf8');
  fs.writeFileSync(fileB, '# search b\n\nonly one zebrafone in this one\n', 'utf8');
  await sleep(1200); // fs.watch refreshes the tree

  key('F', ['control', 'shift']);
  await sleep(500);
  const opened = await js(
    `(function(){var o=document.getElementById('search-overlay');return {open:!o.classList.contains('hidden'),focused:document.activeElement&&document.activeElement.id==='search-input'};})()`
  );
  check('full text search: Ctrl+Shift+F opens the overlay with the field focused', !!opened && opened.open && opened.focused, JSON.stringify(opened));

  await js(`(function(){var i=document.getElementById('search-input');i.value='zebrafone';i.dispatchEvent(new Event('input'));})()`);
  await sleep(1200);
  const results = await js(
    `(function(){var files=[...document.querySelectorAll('#search-results .search-file')].map(function(f){return {name:f.querySelector('span').textContent,n:f.querySelector('.search-file-count').textContent};});return {files:files,lines:document.querySelectorAll('#search-results .search-line').length,status:document.getElementById('search-status').textContent,hits:searchHits.length};})()`
  );
  const names = (results.files || []).map((a) => a.name).sort().join(',');
  check(
    'full text search finds the term in both files with the right count (3 lines)',
    !!results && results.lines === 3 && results.hits === 3 && names === 'search-a-e2e.md,search-b-e2e.md' && /3 results in 2 files/.test(results.status),
    JSON.stringify(results)
  );

  const highlight = await js(
    `(function(){var m=document.querySelector('#search-results .search-line .search-hit');if(!m)return null;var c=getComputedStyle(m);return {text:m.textContent,color:c.color};})()`
  );
  check('full text search highlights the snippet in the line', !!highlight && highlight.text === 'zebrafone', JSON.stringify(highlight));

  await js(
    `(function(){var i=document.getElementById('search-input');i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));})()`
  );
  await sleep(200);
  const sel = await js(`(function(){return {idx:searchSel,path:searchHits[searchSel]?searchHits[searchSel].path:null};})()`);
  await js(`document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await sleep(1200);
  const openedHit = await js('currentPath');
  check(
    'full text search: arrows walk the matches and Enter opens the right file',
    !!sel && sel.idx === 2 && sel.path === fileB && openedHit === fileB,
    JSON.stringify({ sel, openedHit })
  );

  await js(`openSearch()`);
  await sleep(300);
  const beforeEsc = await js(`!document.getElementById('search-overlay').classList.contains('hidden')`);
  await js(`document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await sleep(300);
  const afterEsc = await js(`document.getElementById('search-overlay').classList.contains('hidden')`);
  const paletteAction = await js(`PALETTE_ACTIONS.map(function(a){return typeof a.label==='function'?a.label():a.label;}).indexOf('search in folder')!==-1`);
  check(
    'full text search: Esc closes it and the palette has the "search in folder" action',
    beforeEsc === true && afterEsc === true && paletteAction === true,
    JSON.stringify({ beforeEsc, afterEsc, paletteAction })
  );

  await openPath(demoPath);
  await forget(['search-a-e2e', 'search-b-e2e']);
  fs.rmSync(fileA, { force: true });
  fs.rmSync(fileB, { force: true });
  await sleep(800);
}

module.exports = { run };
