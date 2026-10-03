// The session remembers where each tab was scrolled to: the snapshot carries
// the scroll position, and restoring the session puts the note back there.

async function run(ctx) {
  const { js, sleep, check, fs, userDir, openPath, until, demoPath } = ctx;

  const fixture = userDir('scroll-check.md');
  const body = ['# Scroll', ''].concat(Array.from({ length: 120 }, (_, i) => 'Paragraph ' + i + ' of a note long enough to scroll.\n')).join('\n');
  fs.writeFileSync(fixture, body, 'utf8');
  const P = JSON.stringify(fixture);
  const scroller = `(function(){var p=panes.find(function(x){return x.path===${P};});if(!p)return null;var root=p.el.querySelector('.vditor-ir .vditor-reset');return scrollContainerOf(root,p)||root;})()`;

  try {
    await js('config.focusMode=false;config.typewriterMode=false;applyFocusMode();applyTypewriterMode()');
    await openPath(fixture);
    await until(`!!${scroller}&&${scroller}.scrollHeight>${scroller}.clientHeight+400`);
    await js(`${scroller}.scrollTop=900`);
    await sleep(100);
    const snap = await js('sessionSnapshot()');
    const kept = snap && snap.scroll ? snap.scroll[fixture] : null;
    check('session: the snapshot carries where each tab was scrolled to', kept >= 850 && kept <= 950, JSON.stringify({ kept }));

    // A fresh restore: no tab open, the session holds only this note.
    await js(`[...panes].forEach(function(p){setPaneDirty(p,false);closePane(p);})`);
    await js(`config.session={groups:[{size:1,files:[${P}]}],active:${P},scroll:{[${P}]:${kept || 900}}}`);
    await js('restoreSession().then(function(){return true;})');
    const back = await until(`(function(){var s=${scroller};return s&&s.scrollTop>0?Math.round(s.scrollTop):null;})()`, { ceiling: 5000 });
    check('session: restoring it reopens the note where the reading stopped', back !== null && Math.abs(back - (kept || 900)) <= 40, JSON.stringify({ back, kept }));
  } finally {
    await js(`[...panes].filter(function(x){return x.path===${P};}).forEach(function(x){setPaneDirty(x,false);closePane(x);})`);
    await openPath(demoPath);
    fs.rmSync(fixture, { force: true, maxRetries: 10, retryDelay: 200 });
  }
}

module.exports = { run };
