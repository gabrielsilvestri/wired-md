// Unsaved edits that survive a crash: a dirty tab leaves a snapshot in the
// profile's recovery folder, saving takes it away, a snapshot found at launch
// comes back as an unsaved tab with an inline note (in place, or as a new tab
// when the file is gone), and "don't save" on close throws them all away.

async function run(ctx) {
  const { js, check, fs, path, userDir, openPath, until, demoPath } = ctx;

  const dir = userDir('recovery');
  const fixture = userDir('recovery-check.md');
  const goneFile = userDir('recovery-gone.md');
  fs.writeFileSync(fixture, '# Recovery\n\nsaved text\n', 'utf8');
  const snaps = () => {
    try {
      return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
    } catch {
      return [];
    }
  };
  const P = JSON.stringify(fixture);
  const closeMine = () => js(`[...panes].filter(function(x){return !x.path||x.path.indexOf('recovery-')!==-1;}).forEach(function(x){setPaneDirty(x,false);closePane(x);})`);

  try {
    await js('[...panes].forEach(function(p){setPaneDirty(p,false);})');
    await js('window.wiredRecovery.settleRecovery(true).then(function(){return true;})');
    await openPath(fixture);
    await js(`(function(){var p=panes.find(function(x){return x.path===${P};});p.vditor.setValue('# Recovery\\n\\nunsaved text\\n');setPaneDirty(p,true);})()`);
    await js('window.wiredRecovery.snapshotNow()');
    const taken = snaps().filter((s) => s.path === fixture);
    check(
      'recovery: a tab with unsaved edits leaves a snapshot of its text in the profile',
      taken.length === 1 && taken[0].content.includes('unsaved text'),
      JSON.stringify(taken.map((s) => ({ path: s.path, content: s.content })))
    );

    await js(`(function(){var p=panes.find(function(x){return x.path===${P};});setActivePane(p);})()`);
    await js('void save()');
    await until(`!panes.find(function(x){return x.path===${P};}).dirty`);
    await js('window.wiredRecovery.snapshotNow()');
    check('recovery: saving the tab takes its snapshot away', snaps().filter((s) => s.path === fixture).length === 0, JSON.stringify(snaps().map((s) => s.path)));

    // A snapshot left by a session that never closed: one for an existing
    // file, one for a file that is gone since.
    await closeMine();
    fs.mkdirSync(dir, { recursive: true });
    // Named the way the app names them (a hash of the key), as a crash leaves them.
    const nameOf = (key) => require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 16) + '.json';
    const crashA = path.join(dir, nameOf('file:crash-a'));
    const crashB = path.join(dir, nameOf('file:crash-b'));
    fs.writeFileSync(crashA, JSON.stringify({ key: 'file:crash-a', path: fixture, content: '# Recovery\n\nrecovered text\n', savedAt: 1 }));
    fs.writeFileSync(crashB, JSON.stringify({ key: 'file:crash-b', path: goneFile, content: '# Gone\n\nonly in the snapshot\n', savedAt: 2 }));
    const restored = await js('window.wiredRecovery.restoreRecovery()');
    const back = await js(`(function(){var p=panes.find(function(x){return x.path===${P};});var s=p&&p.el.querySelector('.pane-status');return p?{dirty:p.dirty,value:p.vditor.getValue(),status:s?s.textContent:''}:null;})()`);
    const orphan = await js(`(function(){var p=panes.find(function(x){return !x.path&&x.vditor&&x.vditor.getValue().indexOf('only in the snapshot')!==-1;});var s=p&&p.el.querySelector('.pane-status');return p?{dirty:p.dirty,status:s?s.textContent:''}:null;})()`);
    check(
      'recovery: at launch a snapshot comes back as an unsaved tab with an inline note, the file on disk untouched',
      restored === 2 && !!back && back.dirty && back.value.includes('recovered text') && /Recovered unsaved edits/.test(back.status) &&
        fs.readFileSync(fixture, 'utf8').includes('saved text'),
      JSON.stringify({ restored, back })
    );
    check(
      'recovery: a snapshot of a file that is gone opens as a new unsaved tab that says where it came from',
      !!orphan && orphan.dirty && orphan.status.includes('no longer on disk'),
      JSON.stringify(orphan)
    );
    check('recovery: the old snapshots are consumed, the restored tabs keep their own', !fs.existsSync(crashA) && !fs.existsSync(crashB));

    await js('window.wiredRecovery.settleRecovery(true).then(function(){return true;})');
    check("recovery: don't save on close throws every snapshot away", snaps().length === 0, JSON.stringify(snaps().map((s) => s.key)));
  } finally {
    await closeMine();
    await js('window.wiredRecovery.snapshotNow()');
    fs.rmSync(fixture, { force: true });
    fs.rmSync(goneFile, { force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
