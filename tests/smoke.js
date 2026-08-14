// Smoke test (WIRED_SMOKE=1): opens the terminal, runs an echo, and logs what
// the xterm showed, plus the config and the theme list. Verification with no
// interaction at all, and no assertions: it is a heartbeat, not a suite.
//
//   npm run smoke
//   $env:WIRED_SMOKE='1'; npm start

const { currentTerminal } = require('../src/main/ipc/terminal');

async function run({ window: win, app }) {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await sleep(2500);
    await js('toggleTerminal(true)');
    await sleep(3000);
    await js(`window.wired.termInput('echo hi_wired_' + (40+2) + '\\r')`);
    await sleep(2500);
    const buf = await js(
      `(function(){var out=[];for(var i=0;i<xterm.buffer.active.length;i++){var l=xterm.buffer.active.getLine(i);if(l)out.push(l.translateToString(true));}return out.join('\\n');})()`
    );
    const term = currentTerminal();
    console.log('[smoke] backend=' + (term ? term.kind : 'none'));
    console.log('[smoke] buffer:\n' + buf);
    console.log('[smoke] echo ok: ' + /hi_wired_42/.test(buf));
    const cfg = await js('JSON.stringify(config)');
    console.log('[smoke] config: ' + cfg);
    const themes = await js(`window.wired.listThemes()`);
    console.log('[smoke] themes: ' + JSON.stringify(themes));
    if (process.env.WIRED_SMOKE_SET === '1') {
      await js(
        `(async()=>{config.theme='light';config.accent='#7a4fc7';config.fontSize=17;config.snippets=['example-underlined-headings.css'];await applyTheme('light');await applySnippets();await saveConfig();})()`
      );
      await sleep(800);
    }
    const visual = await js(
      `JSON.stringify({bg:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),fs:getComputedStyle(document.documentElement).getPropertyValue('--font-size-body').trim(),snippets:document.querySelectorAll('style[data-snippet]').length})`
    );
    console.log('[smoke] visual state: ' + visual);
  } catch (err) {
    console.log('[smoke] failed: ' + err.message);
  }
  app.quit();
}

module.exports = { run };
