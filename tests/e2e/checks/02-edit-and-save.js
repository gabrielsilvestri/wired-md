// Typing with real key events marks the pane dirty, Ctrl+S writes to disk, and
// the fixture is put back the way it was.

async function run(ctx) {
  const { js, key, type, sleep, check, fs, win, demoPath } = ctx;

  const original = fs.readFileSync(demoPath, 'utf8');
  win.focus();
  await js('vditor.focus()');
  await sleep(300);
  await type('zeta42');
  await sleep(1500);

  const isDirty = await js('dirty');
  const title = win.getTitle();
  check('editing marks the pane dirty and the title gets the dot', isDirty === true && title.startsWith('● '), title);

  key('S', ['control']);
  await sleep(900);
  const onDisk = fs.readFileSync(demoPath, 'utf8');
  const cleared = await js('dirty');
  check('Ctrl+S wrote to disk and cleared the dirty flag', onDisk.includes('zeta42') && cleared === false, 'dirty=' + cleared);

  // Undo the edit so the repo stays clean.
  fs.writeFileSync(demoPath, original, 'utf8');
  await js(`(function(){vditor.setValue(${JSON.stringify(original)});setDirty(false);})()`);
  check('demo content restored', !fs.readFileSync(demoPath, 'utf8').includes('zeta42'));
}

module.exports = { run };
