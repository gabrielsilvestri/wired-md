// Errors that used to be alert() boxes are a note in the corner now: shown
// without blocking (the suite would freeze on a real alert), readable in every
// theme, gone on a click.

async function run(ctx) {
  const { js, sleep, check, until, openPath, demoPath, win, fs } = ctx;

  try {
    // A real path: the AI bridge with no note open used to alert.
    await js(`[...panes].forEach(function(p){setPaneDirty(p,false);closePane(p);})`);
    await js('void sendFileToClaude()');
    const shown = await until(`(function(){var t=[...document.querySelectorAll('#toasts .toast')].map(function(x){return x.textContent;});return t.some(function(s){return /No file open to send to/.test(s);})?t:null;})()`, { ceiling: 3000 });
    check('toast: the bridge with no note open says so in a corner note instead of a blocking alert', !!shown, JSON.stringify(shown));

    // WIRED_TOAST_SHOT=<file.png> captures the window with the note up.
    if (process.env.WIRED_TOAST_SHOT) await sleep(500);
    if (process.env.WIRED_TOAST_SHOT) fs.writeFileSync(process.env.WIRED_TOAST_SHOT, (await win.webContents.capturePage()).toPNG());

    const themes = await js('window.wired.listThemes()');
    const oldTheme = await js('config.theme');
    const ratios = [];
    for (const t of themes) {
      const name = typeof t === 'string' ? t : t.name;
      await js(`void applyTheme(${JSON.stringify(name)})`);
      await sleep(250);
      ratios.push(await js(`(function(){var rgb=function(s){return s.match(/[\\d.]+/g).map(Number).slice(0,3);};var c=getComputedStyle(document.querySelector('#toasts .toast'));return contrastRatio(rgb(c.color),rgb(c.backgroundColor));})()`));
    }
    await js(`void applyTheme(${JSON.stringify(oldTheme)})`);
    check('toast: its text stays between 4.5:1 and 11:1 in every theme', ratios.every((r) => r >= 4.5 && r <= 11), JSON.stringify(ratios));

    await js(`[...document.querySelectorAll('#toasts .toast')].forEach(function(t){t.click();})`);
    check('toast: a click dismisses it', await until(`document.querySelectorAll('#toasts .toast').length===0`, { ceiling: 2000 }));
  } finally {
    await js(`[...document.querySelectorAll('#toasts .toast')].forEach(function(t){t.remove();})`);
    await openPath(demoPath);
  }
}

module.exports = { run };
