// The status bar (words, characters, token estimate, selection) and the outline
// (headings of the active note, click to jump), both driven through their real
// DOM and the palette, against a fixture with frontmatter and a fenced code
// block that holds a fake heading.

async function run(ctx) {
  const { js, sleep, check, openPath, fs, userDir, readConfigFile, win } = ctx;

  const filler = Array.from({ length: 40 }, (_, i) => `Filler paragraph number ${i} to make the note scroll.`).join('\n\n');
  const fm = '---\ntitle: Counting\ntags: [a, b]\n---\n';
  const body = `# Top\n\nOne two three.\n\n## Second\n\n\`\`\`sh\n# not a heading\n\`\`\`\n\n${filler}\n\n### Third\n\nfour five\n\n#### Fourth\n\nend\n`;
  const fixture = userDir('outline-status-check.md');
  fs.writeFileSync(fixture, fm + body);

  // Polls an expression in the renderer until it is true (ceiling, never a fixed sleep).
  const until = async (expr, ceiling = 4000) => {
    const t = Date.now();
    while (Date.now() - t < ceiling) {
      if (await js(expr)) return true;
      await sleep(60);
    }
    return false;
  };
  const text = (id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const runAction = (label) => js(`(function(){var a=PALETTE_ACTIONS.find(function(x){return (typeof x.label==='function'?x.label():x.label)===${JSON.stringify(label)};});if(a)a.run();return !!a;})()`);
  const barHidden = () => js(`document.getElementById('status-bar').classList.contains('hidden')`);

  try {
    // Reset the state this check reads before asserting.
    await js(`config.statusBar=true;config.outline=true;config.outlineCollapsed=false;saveConfig()`);
    win.setSize(1360, 840);
    await openPath(fixture);
    await until(`activePane() && activePane().path && activePane().path.indexOf('outline-status-check')!==-1 && activePane().ready && document.getElementById('status-words').textContent!==''`);

    // Expected numbers come from the fixture itself, computed independently.
    const source = await js('activePane().vditor.getValue()');
    const bodyOnly = source.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
    const words = (bodyOnly.match(/\S+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const tokens = Math.ceil(source.length / 4);
    const tokenText = tokens < 1000 ? `~${tokens} tokens` : `~${Math.round(tokens / 100) / 10}k tokens`;
    check('status bar: words exclude the frontmatter, characters and tokens include it',
      await until(`document.getElementById('status-words').textContent==='${words.toLocaleString('en-US')} words'`) &&
      (await text('status-chars')) === `${source.length.toLocaleString('en-US')} characters` &&
      source.includes('title: Counting') && !bodyOnly.includes('title: Counting'),
      JSON.stringify({ words, chars: source.length, shown: await text('status-words') }));
    check('status bar: the token count is labeled as an estimate (characters / 4) with an explaining tooltip',
      (await text('status-tokens')) === tokenText &&
      await js(`/divided by about 4/i.test(document.getElementById('status-tokens').title) && /not a tokenizer/i.test(document.getElementById('status-tokens').title)`),
      `${await text('status-tokens')} vs ${tokenText}`);
    check('status bar: it sits between the editor area and the terminal and never overlaps the text',
      await js(`(function(){var b=document.getElementById('status-bar').getBoundingClientRect();var e=document.getElementById('editor-area').getBoundingClientRect();var t=document.getElementById('terminal-panel');return b.height>0 && b.top>=e.bottom-1 && b.height<=32 && document.getElementById('status-bar').nextElementSibling===t;})()`));

    // Live update after an edit (setValue does not fire the input callback, so
    // this also proves the bar follows the DOM and not a single hook).
    await js(`activePane().vditor.setValue(${JSON.stringify(fm + '# Top\n\nOne two three four five six seven.\n')})`);
    check('status bar: counts update live after an edit',
      await until(`document.getElementById('status-words').textContent==='8 words'`), await text('status-words'));

    // Selection count.
    await js(`(function(){var p=activePane().el.querySelector('.vditor-ir .vditor-reset p');var n=p.firstChild;var r=document.createRange();r.setStart(n,0);r.setEnd(n,13);var s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    check('status bar: selecting text shows the selected word count',
      await until(`/^3 words selected$/.test(document.getElementById('status-selection').textContent)`), await text('status-selection'));
    await js(`getSelection().removeAllRanges()`);
    check('status bar: the selection note disappears with the selection',
      await until(`document.getElementById('status-selection').classList.contains('hidden')`));

    // Outline from the full fixture.
    await js(`activePane().vditor.setValue(${JSON.stringify(fm + body)})`);
    await until(`document.querySelectorAll('#outline-list .outline-item').length===4`);
    const outline = await js(`[...document.querySelectorAll('#outline-list .outline-item')].map(function(li){return li.dataset.level+':'+li.textContent+':'+li.style.paddingLeft;})`);
    const lefts = outline.map((s) => parseInt(s.split(':')[2], 10));
    check('outline: lists H1 to H4 with their levels, indented by depth, without the heading inside a code fence',
      outline.length === 4 && outline.map((s) => s.split(':').slice(0, 2).join(':')).join('|') === '1:Top|2:Second|3:Third|4:Fourth' &&
      lefts[0] < lefts[1] && lefts[1] < lefts[2] && lefts[2] < lefts[3],
      JSON.stringify(outline));

    // Click to jump: scroll the heading into view and put the caret in it.
    await js(`(function(){var c=document.querySelectorAll('#outline-list .outline-item')[2];c.click();})()`);
    const jumped = await until(`(function(){
      var h=[...activePane().el.querySelectorAll('.vditor-ir .vditor-reset > h3')][0];
      var s=getSelection();
      if(!h||!s.anchorNode||!h.contains(s.anchorNode))return false;
      var r=h.getBoundingClientRect();return r.top>=0 && r.bottom<=window.innerHeight;
    })()`);
    check('outline: clicking a heading scrolls it into view and puts the caret in it', jumped);
    check('outline: the heading under the caret is highlighted',
      await until(`(function(){var c=document.querySelector('#outline-list .outline-item.current');return !!c && c.textContent==='Third';})()`),
      await js(`(document.querySelector('#outline-list .outline-item.current')||{}).textContent`));

    // The fake heading is not a heading: it must not shift the jump either.
    await js(`document.querySelectorAll('#outline-list .outline-item')[1].click()`);
    check('outline: jumping to the heading before a code fence lands on it, not on the fake one',
      await until(`(function(){var h=[...activePane().el.querySelectorAll('.vditor-ir .vditor-reset > h2')][0];var s=getSelection();return !!h&&!!s.anchorNode&&h.contains(s.anchorNode);})()`));

    // Live update after typing a new heading.
    await js(`activePane().vditor.setValue(${JSON.stringify(fm + body + '\n## Added later\n')})`);
    check('outline: a new heading shows up after an edit',
      await until(`document.querySelectorAll('#outline-list .outline-item').length===5 && [...document.querySelectorAll('#outline-list .outline-item')].pop().textContent==='Added later'`));

    // Tab switch.
    const other = userDir('outline-status-other.md');
    fs.writeFileSync(other, '# Other note\n\nTwo words.\n');
    await openPath(other);
    check('tabs: the outline and the counts follow the active tab',
      await until(`(function(){var it=document.querySelectorAll('#outline-list .outline-item');return it.length===1 && it[0].textContent==='Other note' && /^\\d+ words$/.test(document.getElementById('status-words').textContent) && document.getElementById('status-words').textContent!=='${words} words';})()`),
      await text('status-words'));

    // Toggles persist.
    await runAction('status bar: hide');
    await until(`document.getElementById('status-bar').classList.contains('hidden')`);
    await sleep(300);
    const cfgOff = readConfigFile();
    check('status bar: the palette action hides it and the choice persists in config.json',
      (await barHidden()) && cfgOff.statusBar === false && await js(`PALETTE_ACTIONS.some(function(a){return (typeof a.label==='function'?a.label():a.label)==='status bar: show';})`));
    await runAction('status bar: show');
    check('status bar: the palette action brings it back', await until(`!document.getElementById('status-bar').classList.contains('hidden')`) && readConfigFile().statusBar !== false);

    await runAction('outline: hide');
    await until(`document.getElementById('outline-section').classList.contains('hidden')`);
    await sleep(300);
    check('outline: the palette action hides it and the choice persists in config.json',
      await js(`getComputedStyle(document.getElementById('outline-section')).display==='none'`) && readConfigFile().outline === false);
    await runAction('outline: show');
    await until(`!document.getElementById('outline-section').classList.contains('hidden')`);
    await js(`document.getElementById('outline-header').click()`);
    await sleep(300);
    check('outline: the header collapses the list and the state persists',
      await js(`getComputedStyle(document.getElementById('outline-list')).display==='none' && document.getElementById('outline-header').getAttribute('aria-expanded')==='false'`) && readConfigFile().outlineCollapsed === true);
    await js(`document.getElementById('outline-header').click()`);

    // Opt in screenshots for review (WIRED_OUTLINE_SHOT=<folder>), never written by a normal run.
    if (process.env.WIRED_OUTLINE_SHOT) {
      await js(`activePane().vditor.setValue(${JSON.stringify(fm + body)})`);
      await sleep(500);
      await js(`document.querySelectorAll('#outline-list .outline-item')[2].click()`);
      await js(`(function(){var p=activePane().el.querySelector('.vditor-ir .vditor-reset p');var n=p.firstChild;var r=document.createRange();r.setStart(n,0);r.setEnd(n,Math.min(14,n.length));var s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
      await sleep(500);
      const shoot = async (name, theme, w) => {
        await js(`void applyTheme(${JSON.stringify(theme)})`); win.setSize(w, 840); await sleep(450);
        fs.writeFileSync(require('path').join(process.env.WIRED_OUTLINE_SHOT, name), (await win.webContents.capturePage()).toPNG());
      };
      await shoot('dark-wide.png', 'wired', 1360);
      await shoot('dark-narrow.png', 'wired', 900);
      await shoot('light-wide.png', 'light', 1360);
      await shoot('light-narrow.png', 'light', 900);
      await js(`void applyTheme(${JSON.stringify(await js('config.theme'))})`);
    }

    // Contrast of the new text in every bundled theme.
    const themes = await js('window.wired.listThemes()');
    const oldTheme = await js('config.theme');
    const ratios = [];
    for (const theme of themes) {
      const name = typeof theme === 'string' ? theme : theme.name;
      await js(`void applyTheme(${JSON.stringify(name)})`); await sleep(160);
      ratios.push(await js(`(function(){
        var rgb=function(s){return s.match(/[\\d.]+/g).map(Number).slice(0,3);};
        var pair=function(el,bgEl){var c=getComputedStyle(el),b=getComputedStyle(bgEl);return contrastRatio(rgb(c.color),rgb(b.backgroundColor));};
        var bar=document.getElementById('status-bar');
        var sel=document.getElementById('status-selection');
        var item=document.querySelector('#outline-list .outline-item');
        var side=document.getElementById('sidebar');
        item.classList.add('current');
        var cur=pair(item,side);
        item.classList.remove('current');
        return [pair(document.getElementById('status-words'),bar), pair(sel,bar), pair(item,side), cur, pair(document.getElementById('outline-header'),side)];
      })()`));
    }
    await js(`void applyTheme(${JSON.stringify(oldTheme)})`);
    check('contrast: status bar and outline text stay between 4.5:1 and 11:1 in every theme',
      themes.length >= 5 && ratios.flat().every((r) => r >= 4.5 && r <= 11), JSON.stringify(ratios));

    // Zero tabs: nothing stale.
    await js(`[...panes].forEach(function(p){setPaneDirty(p,false);closePane(p);})`);
    check('zero tabs: the status bar and the outline are empty or hidden, never stale',
      await until(`document.getElementById('status-bar').classList.contains('hidden') && getComputedStyle(document.getElementById('outline-section')).display==='none'`));
    await js(`void newFile()`);
    check('zero tabs: opening a new tab brings both back',
      await until(`!document.getElementById('status-bar').classList.contains('hidden') && !document.getElementById('outline-section').classList.contains('hidden')`));
  } finally {
    await js(`config.statusBar=true;config.outline=true;config.outlineCollapsed=false;saveConfig()`);
    win.setSize(1360, 840);
    await ctx.forget(['outline-status-check.md', 'outline-status-other.md']);
    fs.rmSync(fixture, { force: true });
    fs.rmSync(userDir('outline-status-other.md'), { force: true });
    await js(`[...panes].filter(function(p){return !p.path;}).forEach(function(p){setPaneDirty(p,false);closePane(p);})`);
    await openPath(ctx.demoPath);
  }
}
module.exports = { run };
