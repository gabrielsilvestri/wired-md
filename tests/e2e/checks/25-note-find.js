// The bar is driven through real shortcuts and its public DOM controls.
async function run(ctx) {
  const { js, key, sleep, check, openPath, demoPath, fs, userDir, win } = ctx;
  const sample = '# Search note\n\nAlpha alpha alphabet ALPHA. café cafés café.\n\nA **bold phrase** ends here.\n\n```js\nconst alpha = "alpha";\n```\n\n| Key | Value |\n| --- | --- |\n| alpha | keep |\n\n[alpha](https://example.com/alpha)\n';
  const setQuery = async (value) => {
    await js(`(() => {const q=document.getElementById('note-find-query');q.value=${JSON.stringify(value)};q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(80);
  };
  const click = async (name) => { await js(`document.getElementById('note-find-${name}').click()`); await sleep(100); };
  const count = () => js(`document.getElementById('note-find-count').textContent`);
  const value = () => js('activePane().vditor.getValue()');
  const setReplacement = (text) => js(`document.getElementById('note-find-replacement').value=${JSON.stringify(text)}`);
  const fixture = userDir('find-check.md');
  fs.writeFileSync(fixture, sample);
  try {
    await openPath(fixture);
    await js(`config.focusMode=false;config.typewriterMode=false;applyFocusMode();applyTypewriterMode();activePane().vditor.focus()`);
    key('F', ['control']);
    await sleep(150);
    const opened = await js(`document.activeElement.id==='note-find-query' && document.getElementById('note-find').closest('.pane')===activePane().el`);
    check('find: Ctrl+F inside the editor opens a bar on the active pane', opened);
    const before = await value();
    await setQuery('alpha');
    check('find: counts prose, code and table text once, excluding a link destination', await count() === '1 of 8', await count());
    if (process.env.WIRED_FIND_SHOT) {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(process.env.WIRED_FIND_SHOT, image.toPNG());
    }
    key('Return'); await sleep(80);
    const next = await count();
    key('Return', ['shift']); await sleep(80);
    const prev = await count();
    key('Return', ['shift']); await sleep(80);
    check('find: Enter and Shift+Enter navigate and wrap', next === '2 of 8' && prev === '1 of 8' && await count() === '8 of 8');
    await click('case');
    check('find: match case filters results', await count() === '1 of 6', await count());
    await click('word');
    check('find: whole word excludes alphabet', await count() === '1 of 5', await count());
    await setQuery('café');
    check('find: whole word respects accented letters', await count() === '1 of 2', await count());
    await click('case'); await click('word');
    await setQuery('bold phrase');
    check('find: formatted text is searchable without markdown markers', await count() === '1 of 1');
    await setQuery('A bold phrase ends');
    check('find: a phrase can span inline formatting', await count() === '1 of 1', await count());
    await setQuery('[.*]');
    check('find: metacharacters are literal and no matches disables replacements', await js(`document.getElementById('note-find-count').textContent==='No matches' && document.getElementById('note-find-all').disabled`));
    check('find: searching leaves the Markdown and dirty flag untouched', before === await value() && await js('activePane().dirty===false'));
    await setQuery('const alpha');
    check('find: navigation reveals a hidden code source and keeps keyboard focus in the bar', await js(`(() => {
      const range=[...CSS.highlights.get('note-find-current')][0];
      return range.getBoundingClientRect().height>0 && document.activeElement.id==='note-find-query';
    })()`));

    key('H', ['control']); await sleep(100);
    await setQuery('alpha');
    await click('word');
    await setReplacement('omega');
    await click('replace');
    check('find: Ctrl+H and replace change only the current occurrence', await js(`getComputedStyle(document.getElementById('note-find-replace-row')).display!=='none'`) && (await value()).includes('omega alpha alphabet ALPHA') && await js('activePane().dirty'));
    await click('all');
    const replaced = await value();
    check('find: replace all preserves code fences, tables and link URLs', replaced.includes('omega omega alphabet omega') && replaced.includes('const omega = "omega";') && replaced.includes('| omega') && replaced.includes('[omega](https://example.com/alpha)'));
    key('Escape'); await sleep(100);
    key('Z', ['control']); await sleep(500);
    check('find: replace all is one undo step', (await value()).includes('omega alpha alphabet ALPHA'));
    key('Z', ['control']); await sleep(500);
    check('find: replacing one match also supports undo', await value() === before);
    key('Y', ['control']); await sleep(500);
    check('find: replacement supports redo', (await value()).includes('omega alpha alphabet ALPHA'));

    key('H', ['control']); await sleep(100);
    await setQuery('omega'); await setReplacement('<b>$&</b>'); await click('all');
    const literal = await js(`!activePane().el.querySelector('.vditor-reset b') && activePane().vditor.getValue().includes('$&')`);
    check('find: replacement text cannot inject HTML or expand dollar substitutions', literal);
    await setQuery('ALPHA'); await setReplacement(''); await click('all');
    check('find: an empty replacement deletes whole word matches only', (await value()).includes('alphabet') && !(await value()).includes('ALPHA'));
    key('S', ['control']); await sleep(350);
    check('find: replacements save as plain Markdown without highlight markup', fs.readFileSync(fixture, 'utf8') === await value() && !fs.readFileSync(fixture, 'utf8').includes('note-find'));

    await openPath(demoPath, true);
    await sleep(120);
    check('find: the bar follows a tab into another editor group', await js(`document.getElementById('note-find').closest('.pane')===activePane().el`));
    key('N', ['control']); await sleep(650);
    await js(`activePane().vditor.setValue('fresh fresh\\n')`); await sleep(120);
    await setQuery('fresh');
    const typed = await count();
    await js(`activePane().vditor.setValue('fresh\\n')`); await sleep(120);
    check('find: results refresh when the editor DOM changes', typed === '1 of 2' && await count() === '1 of 1');

    // Theme tokens are measured on the actual bar and both highlight surfaces.
    const themes = await js('window.wired.listThemes()');
    const oldTheme = await js('config.theme');
    const ratios = [];
    for (const theme of themes) {
      const name = typeof theme === 'string' ? theme : theme.name;
      await js(`void applyTheme(${JSON.stringify(name)})`); await sleep(140);
      ratios.push(await js(`(() => {
        const root=activePane().el.querySelector('.vditor-ir .vditor-reset');
        const rgb=s=>s.match(/[\\d.]+/g).map(Number).slice(0,3);
        const a=getComputedStyle(root,'::highlight(note-find-current)');
        const b=getComputedStyle(root,'::highlight(note-find-matches)');
        const c=getComputedStyle(document.getElementById('note-find'));
        return [a,b,c].map(s=>contrastRatio(rgb(s.color),rgb(s.backgroundColor)));
      })()`));
    }
    await js(`void applyTheme(${JSON.stringify(oldTheme)})`);
    check('find: bar and highlights stay between 4.5:1 and 11:1 in every theme', ratios.flat().every(r => r >= 4.5 && r <= 11), JSON.stringify(ratios));
    win.setSize(620, 700); await sleep(200);
    check('find: controls wrap inside a narrow pane', await js(`(() => {const b=document.getElementById('note-find');return b.scrollWidth<=b.clientWidth+1;})()`));
    key('F', ['control']); await sleep(80); key('Escape'); await sleep(80);
    check('find: Escape closes, clears highlights and returns to the editor', await js(`getComputedStyle(document.getElementById('note-find')).display==='none' && !CSS.highlights.has('note-find-current') && document.activeElement.classList.contains('vditor-reset')`));
    await js(`[...panes].forEach(p=>{setPaneDirty(p,false);closePane(p);})`); await sleep(120);
    key('H', ['control']); await sleep(120);
    check('find: zero tabs is a safe disabled state', await count() === 'No open note' && await js(`document.getElementById('note-find-all').disabled`));
    key('N', ['control']); await sleep(650);
    check('find: opening a new tab recovers from zero tabs', await js(`document.getElementById('note-find').closest('.pane')===activePane().el`));
    key('F', ['control']); await sleep(80); key('Escape');
  } finally {
    win.setSize(1360, 840);
    await ctx.forget(['find-check.md']);
    fs.rmSync(fixture, {force:true});
    await js(`[...panes].filter(p=>!p.path).forEach(p=>{setPaneDirty(p,false);closePane(p);})`);
    await openPath(demoPath);
  }
}
module.exports = { run };
