// Closing ONE tab with unsaved changes asks the same three way question as
// closing the window: cancel keeps the tab and the edits, save writes and
// closes, don't save closes without writing. It used to be a confirm() whose
// only "yes" threw the edits away. The native dialog is replaced by the answer
// the check passes in.

async function run(ctx) {
  const { js, check, fs, userDir, openPath, until, forget, demoPath } = ctx;

  const fixture = userDir('tab-close-check.md');
  fs.writeFileSync(fixture, '# Tab close\n\noriginal text\n', 'utf8');
  const find = `panes.find(function(x){return x.path===${JSON.stringify(fixture)};})`;
  const isOpen = () => js(`!!${find}`);
  const request = (answer) =>
    js(`(function(){var asked=null;return confirmClosePane(${find},function(names){asked=names;return Promise.resolve(${JSON.stringify(answer)});}).then(function(r){return {result:r,asked:asked};});})()`);
  const edit = (text) =>
    js(`(function(){var p=${find};setActivePane(p);p.vditor.setValue(${JSON.stringify(text)});setPaneDirty(p,true);})()`);
  const open = async () => {
    await openPath(fixture);
    await until(`!!panes.find(function(x){return x.path===${JSON.stringify(fixture)}&&x.ready;})`);
  };

  try {
    await open();
    await js(`setPaneDirty(${find},false)`);
    const clean = await request('cancel');
    check('tab close: a clean tab closes without asking', clean.result === 'closed' && clean.asked === null && !(await isOpen()), JSON.stringify(clean));

    await open();
    await edit('# Tab close\n\nedited text\n');
    const kept = await request('cancel');
    check(
      'tab close: an unsaved tab asks, naming the note, and cancel keeps the tab, the edits and the file',
      kept.result === 'kept' && Array.isArray(kept.asked) && kept.asked[0] === 'tab-close-check.md' &&
        (await isOpen()) && (await js(`${find}.dirty`)) === true && fs.readFileSync(fixture, 'utf8').includes('original text'),
      JSON.stringify(kept)
    );

    const twice = await js(`(function(){var n=0;var ask=function(){n++;return new Promise(function(r){setTimeout(function(){r('cancel');},300);});};` +
      `var a=confirmClosePane(${find},ask),b=confirmClosePane(${find},ask);return Promise.all([a,b]).then(function(r){return {asks:n,results:r};});})()`);
    check('tab close: asking twice while the question is open asks once', twice.asks === 1 && (await isOpen()), JSON.stringify(twice));

    const saved = await request('save');
    check(
      'tab close: save writes the note and closes the tab',
      saved.result === 'closed' && !(await isOpen()) && fs.readFileSync(fixture, 'utf8').includes('edited text'),
      JSON.stringify(saved)
    );

    await open();
    await edit('# Tab close\n\nnever written\n');
    const dropped = await request('discard');
    check(
      "tab close: don't save closes the tab without writing",
      dropped.result === 'closed' && !(await isOpen()) && !fs.readFileSync(fixture, 'utf8').includes('never written'),
      JSON.stringify(dropped)
    );
  } finally {
    await js(`(function(){var p=${find};if(p){setPaneDirty(p,false);closePane(p);}})()`);
    await forget(['tab-close-check.md']);
    fs.rmSync(fixture, { force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
