// Closing the window with unsaved tabs: nothing unsaved closes at once without
// asking; otherwise cancel keeps everything, save all writes and then closes,
// and don't save closes without writing. The native dialog is replaced by the
// answer the check passes in, and under WIRED_E2E a confirmed close is recorded
// instead of closing the suite's window.

async function run(ctx) {
  const { js, check, fs, userDir, openPath, until, forget, demoPath } = ctx;

  const fixture = userDir('close-check.md');
  fs.writeFileSync(fixture, '# Close\n\noriginal text\n', 'utf8');
  const closes = () => js('window.wired.closeLog().then(function(l){return l.length;})');
  // Runs the close request with a scripted answer and reports what was asked.
  const request = (answer) =>
    js(`(function(){var asked=null;return window.wiredCloseGuard.handleCloseRequest(function(names){asked=names;return Promise.resolve(${JSON.stringify(answer)});}).then(function(r){return {result:r,asked:asked};});})()`);
  const edit = (text) =>
    js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(fixture)};});setActivePane(p);p.vditor.setValue(${JSON.stringify(text)});setPaneDirty(p,true);})()`);

  try {
    await openPath(fixture);
    await until(`!!panes.find(function(x){return x.path===${JSON.stringify(fixture)}&&x.ready;})`);
    await js('panes.forEach(function(p){setPaneDirty(p,false);})');

    const before = await closes();
    const clean = await request('cancel');
    check(
      'close: with nothing unsaved the window closes without asking',
      clean.result === 'closed' && clean.asked === null && (await closes()) === before + 1,
      JSON.stringify(clean)
    );

    await edit('# Close\n\nedited text\n');
    const kept = await request('cancel');
    check(
      'close: with an unsaved tab it asks, naming the note, and cancel keeps the window, the edits and the file',
      kept.result === 'kept' && Array.isArray(kept.asked) && kept.asked.includes('close-check.md') &&
        (await closes()) === before + 1 && (await js('activePane().dirty')) === true && fs.readFileSync(fixture, 'utf8').includes('original text'),
      JSON.stringify(kept)
    );

    const saved = await request('save');
    check(
      'close: save all writes the note and then closes',
      saved.result === 'closed' && (await closes()) === before + 2 && fs.readFileSync(fixture, 'utf8').includes('edited text') && (await js('activePane().dirty')) === false,
      JSON.stringify(saved)
    );

    await edit('# Close\n\nnever written\n');
    const dropped = await request('discard');
    check(
      "close: don't save closes without writing anything",
      dropped.result === 'closed' && (await closes()) === before + 3 && !fs.readFileSync(fixture, 'utf8').includes('never written'),
      JSON.stringify(dropped)
    );
  } finally {
    await js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(fixture)};});if(p){setPaneDirty(p,false);closePane(p);}})()`);
    await forget(['close-check.md']);
    fs.rmSync(fixture, { force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
