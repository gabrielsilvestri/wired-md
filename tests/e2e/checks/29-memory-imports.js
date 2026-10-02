// CLAUDE.md imports: the status bar adds what `@path` imports bring into the
// context (four hops deep, code and emails excluded, escaped spaces honored),
// flags a missing one, Ctrl+click on an import opens it, and nothing of this
// shows for a note that is not a memory file.

async function run(ctx) {
  const { js, sleep, check, fs, path, win, userDir, openPath, until, demoPath } = ctx;

  const dir = userDir('imports-check');
  const w = (rel, text) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
    return p;
  };
  const claude = w('CLAUDE.md', '# Memory\n\nRules live in @rules.md and style in @docs/style.md.\nAPI notes: @Design\\ Docs/api.md\nBroken on purpose: @missing.md\nNot imports: mail a@b.com, `@notimport.md`\n\n```\n@fenced.md\n```\n');
  const rules = w('rules.md', '# Rules\n\nAlways ' + 'x'.repeat(400) + '\n\nNext: @deep1.md\n');
  const style = w('docs/style.md', '# Style\n\n' + 'y'.repeat(120) + '\n');
  const api = w('Design Docs/api.md', '# API\n\n' + 'z'.repeat(60) + '\n');
  // A chain one hop longer than Claude Code follows: rules is hop 1, deep4 hop 5.
  const deep = [1, 2, 3, 4].map((i) => w(`deep${i}.md`, `# Deep ${i}\n\n` + (i < 4 ? `@deep${i + 1}.md\n` : 'the end\n')));
  w('notimport.md', 'never counted\n');
  w('fenced.md', 'never counted\n');
  const counted = [rules, style, api, deep[0], deep[1], deep[2]].reduce((n, p) => n + fs.readFileSync(p, 'utf8').length, 0);
  const expectedTokens = Math.ceil(counted / 4);
  const tokenText = expectedTokens < 1000 ? `~${expectedTokens} tokens` : `~${Math.round(expectedTokens / 100) / 10}k tokens`;

  try {
    await js('config.statusBar=true;saveConfig()');
    await openPath(claude);
    const shown = await until(`(function(){var s=document.getElementById('status-imports');return s&&!s.classList.contains('hidden')&&/^imports /.test(s.textContent);})()`);
    const bar = await js(`(function(){var s=document.getElementById('status-imports');return {text:s.textContent,title:s.title,missing:s.classList.contains('imports-missing')};})()`);
    check(
      'imports: a CLAUDE.md shows what its imports add, four hops deep, with escaped spaces, skipping code, fences and emails',
      shown && bar.text === `imports ${tokenText}, 7 files, 1 missing` && bar.missing &&
        bar.title.includes(path.join(dir, 'Design Docs', 'api.md')) && bar.title.includes(deep[2]) && !bar.title.includes(deep[3]) &&
        !bar.title.includes('notimport') && !bar.title.includes('fenced') && /missing\.md {2}\(missing\)/.test(bar.title),
      JSON.stringify({ bar, tokenText })
    );

    // WIRED_IMPORTS_SHOT=<file.png> captures the window here, to look at it.
    if (process.env.WIRED_IMPORTS_SHOT) fs.writeFileSync(process.env.WIRED_IMPORTS_SHOT, (await win.webContents.capturePage()).toPNG());

    // The missing mark is text: inside the reading band on the status bar.
    const themes = await js('window.wired.listThemes()');
    const oldTheme = await js('config.theme');
    const ratios = [];
    for (const t of themes) {
      const name = typeof t === 'string' ? t : t.name;
      await js(`void applyTheme(${JSON.stringify(name)})`);
      await sleep(250);
      ratios.push(await js(`(function(){var rgb=function(s){return s.match(/[\\d.]+/g).map(Number).slice(0,3);};var s=getComputedStyle(document.getElementById('status-imports'));var b=getComputedStyle(document.getElementById('status-bar'));return contrastRatio(rgb(s.color),rgb(b.backgroundColor));})()`));
    }
    await js(`void applyTheme(${JSON.stringify(oldTheme)})`);
    await sleep(250);
    check('imports: the missing mark stays between 4.5:1 and 11:1 in every theme', ratios.every((r) => r >= 4.5 && r <= 11), JSON.stringify(ratios));

    // A real Ctrl+click on the @rules.md text opens it.
    const at = await js(`(function(){var root=activePane().el.querySelector('.vditor-ir .vditor-reset');var wk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);var n;while((n=wk.nextNode())){var i=n.nodeValue.indexOf('@rules.md');if(i!==-1){var r=document.createRange();r.setStart(n,i+3);r.setEnd(n,i+4);var b=r.getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};}}return null;})()`);
    if (at) {
      win.focus();
      win.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: ['control'] });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: ['control'] });
    }
    const opened = await until(`currentPath===${JSON.stringify(rules)}`, { ceiling: 5000 });
    check('imports: Ctrl+click on an @path in a CLAUDE.md opens the imported note', !!at && opened, JSON.stringify({ at, now: await js('currentPath') }));

    const hiddenElsewhere = await until(`document.getElementById('status-imports').classList.contains('hidden')`);
    check('imports: a note that is not a memory file shows no import count, even with an @path in it', hiddenElsewhere);

    await openPath(claude);
    await js(`void window.wiredImports.openImport(activePane(), '@missing.md')`);
    const status = await until(`(function(){var s=activePane().el.querySelector('.pane-status');return s?s.textContent:'';})()`);
    check('imports: opening a missing import says so inline and stays on the note', /Import not found: .*missing\.md/.test(status || '') && (await js('currentPath')) === claude, String(status));
  } finally {
    await js(`[...panes].filter(function(x){return x.path&&x.path.indexOf('imports-check')!==-1;}).forEach(function(x){setPaneDirty(x,false);closePane(x);})`);
    await openPath(demoPath);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { run };
