// Command palette (filters and runs a real action) and quick switcher (fuzzy
// finds the file and opens it).

async function run(ctx) {
  const { js, sleep, check, fs, forget, openPath, demoPath, state } = ctx;

  await js(`(function(){openPalette('commands');var i=document.getElementById('palette-input');i.value='sidebar';i.dispatchEvent(new Event('input'));})()`);
  await sleep(200);
  const selected = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
  await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await sleep(300);
  const after = await js(
    `(function(){return {closed:document.getElementById('palette-overlay').classList.contains('hidden'),sidebarHidden:document.getElementById('sidebar').classList.contains('hidden')};})()`
  );
  await js(`toggleSidebar()`);
  await sleep(200);
  check(
    'command palette filters and runs (toggle sidebar)',
    selected === 'toggle sidebar' && !!after && after.closed && after.sidebarHidden,
    JSON.stringify({ selected, after })
  );

  await js(`(function(){openPalette('files');var i=document.getElementById('palette-input');i.value='panee2e';i.dispatchEvent(new Event('input'));})()`);
  await sleep(200);
  const swSel = await js(`(function(){var r=document.querySelector('#palette-list .palette-row.selected .palette-label');return r?r.textContent:null;})()`);
  await js(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await sleep(800);
  const swPath = await js('currentPath');
  check('quick switcher finds pane-e2e.md and opens it', swSel === 'pane-e2e.md' && swPath === state.paneFile, JSON.stringify({ swSel, swPath }));

  await openPath(demoPath);
  fs.rmSync(state.paneFile, { force: true });
  await forget(['pane-e2e']);
  await sleep(600);
}

module.exports = { run };
