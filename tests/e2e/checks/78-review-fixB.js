// Review screenshots for the tabs work package: two groups with a resizer, the
// breadcrumb in the editor header, and the empty state with the Lain portrait.
//
// Same contract as 79-review-shots: the layout it builds always runs (the later
// checks inherit that state), and the PNGs are only written with WIRED_SHOTS=1,
// because a picture re-encoded on every run is a dirty working tree on every
// run.

const path = require('path');

const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'review-fixB');
const SHOTS = process.env.WIRED_SHOTS === '1';

async function run(ctx) {
  const { js, sleep, check, fs, win, openPath, fixtures, demoPath } = ctx;

  if (SHOTS) fs.mkdirSync(OUT, { recursive: true });

  await js('toggleTerminal(false)');
  await js('setSidebarVisible(true)');
  win.setSize(1400, 880);
  win.center();
  await sleep(500);

  const shoot = async (name) => {
    if (!SHOTS) return;
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  };
  const written = [];

  // 1. Two groups side by side, three tabs, the resizer between them.
  await openPath(demoPath);
  await openPath(fixtures.notes);
  await openPath(fixtures.skill, true);
  await sleep(1200);
  await js(
    `(function(){var r=document.querySelector('#panes .group-resizer');if(!r)return;var b=r.getBoundingClientRect();var x=b.left+b.width/2,y=b.top+b.height/2;` +
    `r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:x,clientY:y}));` +
    `document.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x+90,clientY:y}));` +
    `document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x+90,clientY:y}));})()`
  );
  await sleep(700);
  await shoot('01-tabs-split-resizer');
  written.push('01-tabs-split-resizer.png');

  // 2. The breadcrumb with a real trail: a note two folders down, so the dim
  //    folder segments and the file in full ink are both in frame. The fixture
  //    is deleted right after, because this repository is the one under test.
  await js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(fixtures.skill)};});if(p){setPaneDirty(p,false);closePane(p);}})()`);
  await sleep(700);
  const nestedDir = path.join(path.dirname(demoPath), 'refs-shot', 'deep');
  const nestedNote = path.join(nestedDir, 'nested-note.md');
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(nestedNote, '# nested note\n\nA note two folders down.\n', 'utf8');
  await sleep(1300);
  // The trail is relative to the tree root, and the root follows the ACTIVE
  // note: with demo.md in front the other group shows the whole path down to
  // the nested note, which is the thing worth photographing.
  await openPath(nestedNote, true);
  await sleep(400);
  await openPath(demoPath);
  await sleep(1000);
  await shoot('02-breadcrumb');
  written.push('02-breadcrumb.png');
  await js(`(function(){var p=panes.find(function(x){return x.path===${JSON.stringify(nestedNote)};});if(p){setPaneDirty(p,false);closePane(p);}})()`);
  await js(
    `(function(){config.recentFiles=config.recentFiles.filter(function(r){return r.indexOf('nested-note')===-1;});saveConfig();renderRecents();})()`
  );
  fs.rmSync(path.join(path.dirname(demoPath), 'refs-shot'), { recursive: true, force: true });
  await sleep(900);

  // 3. The empty state.
  await js(`(function(){[...panes].forEach(function(p){setPaneDirty(p,false);closePane(p);});})()`);
  await sleep(900);
  await shoot('03-empty-state-lain');
  written.push('03-empty-state-lain.png');

  await openPath(demoPath);
  await sleep(700);

  if (!SHOTS) {
    check('review shots for the tabs package skipped (set WIRED_SHOTS=1 to write docs/review-fixB)', true, String(written.length) + ' shots');
    return;
  }
  const onDisk = written.filter((f) => fs.existsSync(path.join(OUT, f)));
  check('review shots written to docs/review-fixB', onDisk.length === written.length, JSON.stringify(onDisk));
}

module.exports = { run };
