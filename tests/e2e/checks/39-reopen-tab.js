// Ctrl+Shift+T brings back the tab closed last, newest first, the way every
// tabbed editor and browser does. A file that is gone from disk is skipped
// instead of opening an error, and a file already open again is not doubled.

async function run(ctx) {
  const { js, check, fs, userDir, openPath, until, forget, demoPath, sleep } = ctx;

  const a = userDir('reopen-a.md');
  const b = userDir('reopen-b.md');
  const gone = userDir('reopen-gone.md');
  fs.writeFileSync(a, '# Reopen A\n', 'utf8');
  fs.writeFileSync(b, '# Reopen B\n', 'utf8');
  fs.writeFileSync(gone, '# Reopen gone\n', 'utf8');
  const has = (p) => js(`!!panes.find(function(x){return x.path===${JSON.stringify(p)};})`);
  const close = (p) => js(`(function(){var x=panes.find(function(y){return y.path===${JSON.stringify(p)};});if(x){setPaneDirty(x,false);closePane(x);}})()`);
  const open = async (p) => {
    await openPath(p);
    await until(`!!panes.find(function(x){return x.path===${JSON.stringify(p)}&&x.ready;})`);
  };
  const shortcut = () => js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'T',ctrlKey:true,shiftKey:true,bubbles:true}))`);

  try {
    await open(a);
    await open(b);
    await close(a);
    await close(b);

    await shortcut();
    const firstBack = await until(`!!panes.find(function(x){return x.path===${JSON.stringify(b)};})`);
    check('reopen: Ctrl+Shift+T brings back the tab closed last', firstBack && !(await has(a)), JSON.stringify({ b: await has(b), a: await has(a) }));

    await js('void reopenClosedTab()');
    const secondBack = await until(`!!panes.find(function(x){return x.path===${JSON.stringify(a)};})`);
    check('reopen: the next one back is the tab closed before it', secondBack, JSON.stringify({ a: await has(a) }));

    await close(a);
    await open(gone);
    await close(gone);
    fs.rmSync(gone, { force: true });
    const before = await js('panes.length');
    await js('void reopenClosedTab()');
    await sleep(800);
    check(
      'reopen: a file gone from disk is skipped and the tab before it comes back instead',
      (await has(a)) && !(await has(gone)) && (await js('panes.length')) === before + 1,
      JSON.stringify({ a: await has(a), gone: await has(gone) })
    );

    const label = await js(`(function(){var x=PALETTE_ACTIONS.find(function(p){var l=typeof p.label==='function'?p.label():p.label;return l==='reopen closed tab';});return x?x.hint:null;})()`);
    check('reopen: the palette has "reopen closed tab" with its shortcut', label === 'Ctrl+Shift+T', String(label));
  } finally {
    await close(a);
    await close(b);
    await close(gone);
    await forget(['reopen-a.md', 'reopen-b.md', 'reopen-gone.md']);
    for (const f of [a, b, gone]) fs.rmSync(f, { force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
