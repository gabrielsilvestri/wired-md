// A long note: 4,000 lines and 200 headings. Five modules read the editor on
// every change (status bar, outline, memory imports, find, recovery), so this
// puts a number in the log for opening, for one getValue and for a burst of
// typing, with ceilings generous enough for a busy machine. A regression shows
// up as a number that jumped, long before it fails.

async function run(ctx) {
  const { js, sleep, check, fs, userDir, openPath, until, type, forget, demoPath } = ctx;

  const fixture = userDir('large-note.md');
  const parts = [];
  for (let s = 0; s < 200; s++) {
    parts.push('## Section ' + s, '');
    for (let l = 0; l < 9; l++) parts.push('Line ' + l + ' of section ' + s + ' with **some** `code` and a [link](https://example.com).');
    parts.push('');
  }
  const text = parts.join('\n');
  fs.writeFileSync(fixture, text, 'utf8');
  const P = JSON.stringify(fixture);

  try {
    const t0 = Date.now();
    await openPath(fixture);
    await until(`(function(){var p=panes.find(function(x){return x.path===${P}&&x.ready;});return !!p&&p.vditor.getValue().length>100000;})()`, { ceiling: 20000 });
    const openMs = Date.now() - t0;

    const getValueMs = await js(`(function(){var p=activePane();var t=performance.now();for(var i=0;i<5;i++)p.vditor.getValue();return Math.round((performance.now()-t)/5);})()`);
    const outlined = await until(`document.querySelectorAll('#outline-list .outline-item').length===200`, { ceiling: 8000 });

    // Typing at the end of the first paragraph, timed until the editor value
    // has every character.
    await js(`(function(){var p=activePane();p.vditor.focus();var para=p.el.querySelector('.vditor-ir .vditor-reset p');var n=para.firstChild;var r=document.createRange();r.setStart(n,4);r.collapse(true);var s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    const t1 = Date.now();
    await type('zyxwvutsrq', 0);
    const typed = await until(`activePane().vditor.getValue().indexOf('zyxwvutsrq')!==-1`, { ceiling: 10000 });
    const typeMs = Date.now() - t1;

    // How many full Markdown readings one keystroke costs once everything that
    // listens has had its say (the status bar, outline, panel and recovery
    // share one through text-cache.js).
    await js(`(function(){var v=activePane().vditor;window.__gv=0;var orig=v.getValue.bind(v);v.getValue=function(){window.__gv++;return orig();};window.__gvRestore=function(){v.getValue=orig;};})()`);
    await type('k', 0);
    await sleep(2600);
    const readings = await js('window.__gv');
    await js('window.__gvRestore()');

    check(
      'large note: one keystroke costs at most two full Markdown readings once the listeners settle',
      readings <= 2,
      JSON.stringify({ readings })
    );
    check(
      'large note: 4,000 lines open, read and take typing within generous ceilings (numbers logged)',
      openMs < 15000 && getValueMs < 500 && !!outlined && !!typed && typeMs < 5000,
      JSON.stringify({ openMs, getValueMs, outlined: !!outlined, typeMs })
    );
  } finally {
    await js(`(function(){var p=panes.find(function(x){return x.path===${P};});if(p){setPaneDirty(p,false);closePane(p);}})()`);
    await forget(['large-note.md']);
    await sleep(200);
    fs.rmSync(fixture, { force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
