// The status bar counts relative links to notes that do not resolve, names
// them in the tooltip, and lets go of a link once its note exists.

async function run(ctx) {
  const { js, check, fs, path, userDir, openPath, until, forget, demoPath } = ctx;

  const sample = '[a](a.md) [web](https://x.example/y.md) ![img](pic.md) `[code](c.md)` [anchor](#top) [h](b.md#sec) [a again](a.md)\n\n```\n[fenced](f.md)\n```\n';
  const found = await js(`window.wiredLinkCheck.localNoteLinks(${JSON.stringify(sample)})`);
  check(
    'link check: only inline links to local notes count, not web links, images, anchors, code or fences',
    JSON.stringify(found) === JSON.stringify(['a.md', 'b.md#sec']),
    JSON.stringify(found)
  );

  const dir = userDir('link-check');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const note = path.join(dir, 'skill.md');
  const missing = path.join(dir, 'references', 'missing.md');
  fs.writeFileSync(path.join(dir, 'here.md'), '# Here\n', 'utf8');
  fs.writeFileSync(note, '# Skill\n\nRead [here](here.md) and [the rules](references/missing.md).\n', 'utf8');
  const find = `panes.find(function(x){return x.path===${JSON.stringify(note)};})`;
  const span = () => js(`(function(){var s=document.getElementById('status-links');return s?{hidden:s.classList.contains('hidden'),text:s.textContent,title:s.title}:null;})()`);

  try {
    await openPath(note);
    await until(`!!panes.find(function(x){return x.path===${JSON.stringify(note)}&&x.ready;})`);
    const broken = await js('window.wiredLinkCheck.updateLinkCheck()');
    const s1 = await span();
    check(
      'link check: a link to a missing note shows "1 broken link" with the target in the tooltip',
      JSON.stringify(broken) === JSON.stringify(['references/missing.md']) && !!s1 && !s1.hidden && s1.text === '1 broken link' && s1.title.includes('references/missing.md'),
      JSON.stringify({ broken, s1 })
    );

    fs.mkdirSync(path.dirname(missing), { recursive: true });
    fs.writeFileSync(missing, '# Rules\n', 'utf8');
    const after = await js('window.wiredLinkCheck.updateLinkCheck()');
    const s2 = await span();
    check('link check: once the note exists the count goes away', Array.isArray(after) && after.length === 0 && !!s2 && s2.hidden, JSON.stringify({ after, s2 }));
  } finally {
    await js(`(function(){var p=${find};if(p){setPaneDirty(p,false);closePane(p);}})()`);
    await forget(['link-check']);
    fs.rmSync(dir, { recursive: true, force: true });
    await openPath(demoPath);
  }
}

module.exports = { run };
