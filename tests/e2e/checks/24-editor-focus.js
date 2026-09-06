// Clicking the document must not replace the theme's paper with Vditor's
// built-in textarea color. Drive a real mouse click, including a light theme.
async function run(ctx) {
  const { js, sleep, check, win, openPath, fixtures } = ctx;
  await openPath(fixtures.skill);
  const originalTheme = await js('config.theme');
  const themes = await js('window.wired.listThemes()');
  try {
    for (const theme of themes) {
      const name = typeof theme === 'string' ? theme : theme.name;
      await js(`void applyTheme(${JSON.stringify(name)})`);
      await sleep(250);
      const before = await js(`(() => {
        document.activeElement?.blur();
        const root = activePane().el.querySelector('.vditor-ir .vditor-reset');
        root.scrollTop = 0;
        const p = root.querySelector('p') || root;
        p.scrollIntoView({block:'center'});
        const r = p.getBoundingClientRect();
        return {bg:getComputedStyle(root).backgroundColor, x:Math.round(r.left+30), y:Math.round(r.top+10)};
      })()`);
      win.focus();
      win.webContents.sendInputEvent({type:'mouseDown', x:before.x, y:before.y, button:'left', clickCount:1});
      win.webContents.sendInputEvent({type:'mouseUp', x:before.x, y:before.y, button:'left', clickCount:1});
      await sleep(180);
      const after = await js(`(() => {
        const root = activePane().el.querySelector('.vditor-ir .vditor-reset');
        const probe = document.createElement('div');
        probe.style.background = 'var(--bg)'; root.append(probe);
        const expected = getComputedStyle(probe).backgroundColor; probe.remove();
        return {bg:getComputedStyle(root).backgroundColor, focused:document.activeElement===root, expected};
      })()`);
      check('editor focus: clicking keeps the paper color in ' + name,
        after.focused && before.bg === after.bg && after.bg === after.expected,
        JSON.stringify({before:before.bg, ...after}));
    }
  } finally {
    await js(`void applyTheme(${JSON.stringify(originalTheme)})`);
    await openPath(fixtures.demo);
  }
}
module.exports = { run };
