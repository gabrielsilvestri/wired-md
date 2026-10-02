// An open note follows its file on disk: a clean pane reloads in place (still
// clean, scroll kept, focus left alone), our own save never echoes back as a
// reload, a pane with edits gets the conflict row and keeps its text, both
// buttons do what they say on disk and in the editor, Ctrl+S never writes over
// an unresolved conflict, and a file deleted or renamed away leaves the tab open
// with the gone row until a save recreates it.

async function run(ctx) {
  const { js, key, type, sleep, check, fs, path, win, userDir, openPath, forget, demoPath } = ctx;

  const dir = userDir('disk-sync');
  fs.mkdirSync(dir, { recursive: true });
  const fileA = path.join(dir, 'disk-sync-a.md');
  const fileB = path.join(dir, 'disk-sync-b.md');
  const moved = path.join(dir, 'disk-sync-moved.md');
  const filler = Array.from({ length: 60 }, (_, i) => 'Paragraph ' + i + ' of a note long enough to scroll.').join('\n\n');
  const versionA = (tag) => '# Disk sync\n\n' + tag + '\n\n' + filler + '\n';
  fs.writeFileSync(fileA, versionA('first version'), 'utf8');
  fs.writeFileSync(fileB, '# Disk sync b\n\nbackground first\n', 'utf8');

  const A = JSON.stringify(fileA);
  const B = JSON.stringify(fileB);
  const pane = (p) => `panes.find(function(x){return x.path===${p};})`;
  const valueOf = (p) => js(`(${pane(p)}||{vditor:{getValue:function(){return ''}}}).vditor.getValue()`);
  const rowOf = (p) => js(`(function(){var x=${pane(p)};var r=x&&x.el.querySelector('.disk-row');return r?r.dataset.mode:null;})()`);
  const dirtyOf = (p) => js(`!!(${pane(p)}||{}).dirty`);
  const disk = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

  // Polls a condition with a ceiling instead of sleeping and hoping.
  const waitFor = async (fn, ceiling) => {
    const started = Date.now();
    while (Date.now() - started < (ceiling || 5000)) {
      if (await fn()) return true;
      await sleep(60);
    }
    return false;
  };

  const shotDir = process.env.WIRED_DISK_SHOT; // opt in: a folder for review PNGs
  const shot = async (name) => {
    if (!shotDir) return;
    await sleep(250);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, name + '.png'), img.toPNG());
  };

  // Typewriter mode recenters the caret on every keystroke and would move the
  // scroll this check measures.
  await js('config.focusMode=false;config.typewriterMode=false;applyFocusMode();applyTypewriterMode()');

  try {
    // A in the left group, B open beside it: B is the background pane that has
    // to follow its file while A is the one in front.
    await openPath(fileA);
    await openPath(fileB, true);
    await openPath(fileA);
    await waitFor(async () => (await js('currentPath')) === fileA);

    // --- 1. clean pane: silent reload, still clean, scroll and focus kept ---
    const before = await js(`(function(){var root=${pane(A)}.el.querySelector('.vditor-ir .vditor-reset');var sc=scrollContainerOf(root,${pane(A)})||root;sc.scrollTop=600;var i=document.createElement('input');i.id='disk-sync-probe';document.body.appendChild(i);i.focus();return {top:sc.scrollTop,reloads:diskReloads};})()`);
    fs.writeFileSync(fileA, versionA('second version from another tool'), 'utf8');
    const reloaded = await waitFor(async () => (await valueOf(A)).includes('second version from another tool'));
    const afterReload = await js(`(function(){var root=${pane(A)}.el.querySelector('.vditor-ir .vditor-reset');var sc=scrollContainerOf(root,${pane(A)})||root;return {top:sc.scrollTop,focus:document.activeElement&&document.activeElement.id,reloads:diskReloads};})()`);
    check(
      'disk sync: an external write reloads a clean open note and it stays clean',
      reloaded && !(await dirtyOf(A)) && !(await rowOf(A)) && afterReload.reloads === before.reloads + 1,
      JSON.stringify({ reloaded, before, afterReload })
    );
    check(
      'disk sync: the reload keeps the scroll position and does not steal the focus',
      before.top > 0 && Math.abs(afterReload.top - before.top) < 40 && afterReload.focus === 'disk-sync-probe',
      JSON.stringify({ before: before.top, after: afterReload.top, focus: afterReload.focus })
    );
    await js(`document.getElementById('disk-sync-probe').remove()`);

    // --- 1b. an atomic save (temp file renamed over the note, the way many
    // editors and agents write) is a change like any other, not a deletion ---
    const tmpA = fileA + '.tmp-e2e';
    fs.writeFileSync(tmpA, versionA('third version written atomically'), 'utf8');
    fs.renameSync(tmpA, fileA);
    const atomic = await waitFor(async () => (await valueOf(A)).includes('third version written atomically'));
    check(
      'disk sync: an atomic save (temp file renamed over the note) reloads it, with no gone row and no unsaved mark',
      atomic && !(await rowOf(A)) && !(await dirtyOf(A)),
      JSON.stringify({ atomic, row: await rowOf(A), dirty: await dirtyOf(A) })
    );

    // --- 2. a background pane in another group follows its file too ---
    fs.writeFileSync(fileB, '# Disk sync b\n\nbackground second\n', 'utf8');
    const bgFollowed = await waitFor(async () => (await valueOf(B)).includes('background second'));
    check(
      'disk sync: a note open in another group (not the active one) follows its file as well',
      bgFollowed && !(await dirtyOf(B)) && (await js('currentPath')) === fileA
    );

    // --- 3. our own save does not come back as a reload ---
    await js(`${pane(A)}.vditor.focus()`);
    await type('q7', 40);
    await waitFor(() => dirtyOf(A));
    key('S', ['control']);
    const saved = await waitFor(async () => (disk(fileA) || '').includes('q7') && !(await dirtyOf(A)));
    const reloadsAtSave = await js('diskReloads');
    // A negative assertion: nothing may happen inside a window longer than the
    // watcher debounce plus a read.
    await sleep(900);
    check(
      'disk sync: our own save does not trigger a reload loop or a row',
      saved && (await js('diskReloads')) === reloadsAtSave && !(await rowOf(A)) && !(await dirtyOf(A)),
      JSON.stringify({ saved, reloadsAtSave, now: await js('diskReloads') })
    );

    // --- 4. pane with edits: the conflict row, local text untouched ---
    await js(`${pane(A)}.vditor.focus()`);
    await type('mine1', 40);
    await waitFor(() => dirtyOf(A));
    fs.writeFileSync(fileA, versionA('theirs one'), 'utf8');
    const conflict = await waitFor(async () => (await rowOf(A)) === 'conflict');
    const localText = await valueOf(A);
    check(
      'disk sync: an external write to a dirty note shows the row and keeps the local text',
      conflict && localText.includes('mine1') && !localText.includes('theirs one') && (await dirtyOf(A)),
      JSON.stringify({ conflict, row: await rowOf(A) })
    );
    if (shotDir) {
      win.setSize(1360, 840);
      await shot('conflict-wide-dark');
      const t = await js('config.theme');
      await js(`void applyTheme('light')`);
      await shot('conflict-wide-light');
      await js(`void applyTheme(${JSON.stringify(t)})`);
    }

    // --- 5. Ctrl+S while the conflict is open does not write ---
    key('S', ['control']);
    const pulsed = await waitFor(() => js(`${pane(A)}.el.querySelector('.disk-row').classList.contains('pulse')`), 1500);
    await sleep(500);
    check(
      'disk sync: Ctrl+S during an unresolved conflict writes nothing and pulses the row',
      pulsed && disk(fileA) === versionA('theirs one') && (await rowOf(A)) === 'conflict' && (await dirtyOf(A))
    );

    // --- 6. keep mine: the next save writes the editor text over the disk ---
    await js(`${pane(A)}.el.querySelector('.disk-row .disk-keep').click()`);
    const keptRowGone = await waitFor(async () => !(await rowOf(A)), 1500);
    const keptDirty = await dirtyOf(A);
    key('S', ['control']);
    const keptSaved = await waitFor(async () => (disk(fileA) || '').includes('mine1') && !(await dirtyOf(A)));
    check(
      'disk sync: "keep mine" closes the row, keeps the edits, and the next save writes them',
      keptRowGone && keptDirty && keptSaved && !(disk(fileA) || '').includes('theirs one') && (await valueOf(A)).includes('mine1')
    );

    // --- 7. reload from disk: the local edits go, the disk version comes in ---
    await js(`${pane(A)}.vditor.focus()`);
    await type('mine2', 40);
    await waitFor(() => dirtyOf(A));
    fs.writeFileSync(fileA, versionA('theirs two'), 'utf8');
    await waitFor(async () => (await rowOf(A)) === 'conflict');
    if (shotDir) {
      const shotTheme = await js('config.theme');
      await js(`void applyTheme('light')`);
      await shot('conflict-light');
      win.setSize(900, 760);
      await shot('conflict-narrow-light');
      await js(`void applyTheme('wired')`);
      await shot('conflict-narrow-wired');
      win.setSize(1360, 840);
      await js(`void applyTheme(${JSON.stringify(shotTheme)})`);
    }
    await js(`${pane(A)}.el.querySelector('.disk-row .disk-reload').click()`);
    const took = await waitFor(async () => (await valueOf(A)).includes('theirs two'), 1500);
    const v = await valueOf(A);
    check(
      'disk sync: "reload from disk" drops the local edits, loads the disk text and leaves the file untouched',
      took && !v.includes('mine2') && !(await dirtyOf(A)) && !(await rowOf(A)) && disk(fileA) === versionA('theirs two')
    );

    // --- 8. the save guard: a change the watcher never reported still stops
    // the save (the watchers are switched off for this step only) ---
    await js(`${pane(A)}.vditor.focus()`);
    await type('mine3', 40);
    await waitFor(() => dirtyOf(A));
    await js('window.wired.watchFiles([])');
    fs.writeFileSync(fileA, versionA('theirs unseen'), 'utf8');
    await sleep(400); // longer than the watcher debounce: nothing may arrive
    const quiet = !(await rowOf(A));
    key('S', ['control']);
    const guarded = await waitFor(async () => (await rowOf(A)) === 'conflict');
    check(
      'disk sync: saving over a disk change the watcher missed raises the row instead of writing',
      quiet && guarded && disk(fileA) === versionA('theirs unseen') && (await valueOf(A)).includes('mine3')
    );
    await js(`${pane(A)}.el.querySelector('.disk-row .disk-reload').click()`);
    await waitFor(async () => !(await rowOf(A)), 1500);

    // --- 9. the row text and buttons, measured in every bundled theme ---
    await js(`${pane(A)}.vditor.focus()`);
    await type('m', 40);
    await waitFor(() => dirtyOf(A));
    fs.writeFileSync(fileA, versionA('theirs three'), 'utf8');
    await waitFor(async () => (await rowOf(A)) === 'conflict');
    const themes = await js('window.wired.listThemes()');
    const oldTheme = await js('config.theme');
    const ratios = {};
    for (const t of themes) {
      const name = typeof t === 'string' ? t : t.name;
      await js(`void applyTheme(${JSON.stringify(name)})`);
      await sleep(160);
      ratios[name] = await js(`(function(){
        var row=${pane(A)}.el.querySelector('.disk-row');
        var rgb=function(s){return s.match(/[\\d.]+/g).map(Number).slice(0,3);};
        var bg=rgb(getComputedStyle(row).backgroundColor);
        var msg=contrastRatio(rgb(getComputedStyle(row.querySelector('.disk-msg')).color),bg);
        var btn=row.querySelector('.disk-btn');
        var b=contrastRatio(rgb(getComputedStyle(btn).color),rgb(getComputedStyle(btn).backgroundColor));
        return [Number(msg.toFixed(2)),Number(b.toFixed(2))];
      })()`);
    }
    await js(`void applyTheme(${JSON.stringify(oldTheme)})`);
    const bundled = ['wired', 'carbon', 'ash', 'light', 'parchment'];
    check(
      'disk sync: the row text and its buttons stay between 4.5:1 and 11:1 in every bundled theme',
      bundled.every((n) => Array.isArray(ratios[n]) && ratios[n].every((r) => r >= 4.5 && r <= 11)),
      JSON.stringify(ratios)
    );
    win.setSize(620, 700);
    await sleep(250);
    check(
      'disk sync: the row wraps inside a narrow group without overflowing',
      await js(`(function(){var r=${pane(A)}.el.querySelector('.disk-row');return r.scrollWidth<=r.clientWidth+1;})()`)
    );
    win.setSize(1360, 840);
    await sleep(150);
    await js(`${pane(A)}.el.querySelector('.disk-row .disk-reload').click()`);
    await waitFor(async () => !(await rowOf(A)), 1500);

    // --- 10. deleted and renamed away: the tab stays, saving recreates it ---
    fs.rmSync(fileA, { force: true });
    const goneShown = await waitFor(async () => (await rowOf(A)) === 'gone');
    check(
      'disk sync: a deleted file keeps its tab open and shows the gone row',
      goneShown && (await js(`!!${pane(A)}`)) && (await valueOf(A)).includes('theirs three')
    );
    // The editor holds the only copy now: the tab is unsaved, so closing it
    // asks instead of discarding the text.
    check('disk sync: a gone file marks its tab unsaved', await js(`${pane(A)}.dirty===true`));
    await shot('gone-wide');
    await js(`setActivePane(${pane(A)})`);
    key('S', ['control']);
    const recreated = await waitFor(async () => fs.existsSync(fileA) && !(await rowOf(A)));
    check('disk sync: saving a gone file recreates it and clears the row', recreated && (disk(fileA) || '').includes('theirs three'));

    fs.renameSync(fileB, moved);
    const renamedAway = await waitFor(async () => (await rowOf(B)) === 'gone');
    check('disk sync: a file renamed away on disk marks its pane gone without closing the tab', renamedAway && (await js(`!!${pane(B)}`)) && (await js(`${pane(B)}.dirty===true`)));
    // Renamed back unchanged: the file is whole again and the clean tab is clean.
    fs.renameSync(moved, fileB);
    const back = await waitFor(async () => !(await rowOf(B)) && (await js(`${pane(B)}.dirty===false`)));
    check('disk sync: a file renamed back unchanged clears the gone row and the unsaved mark', back);
  } finally {
    win.setSize(1360, 840);
    await js(`(function(){var p=document.getElementById('disk-sync-probe');if(p)p.remove();})()`);
    await forget(['disk-sync-a.md', 'disk-sync-b.md', 'disk-sync-moved.md']);
    fs.rmSync(dir, { recursive: true, force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
