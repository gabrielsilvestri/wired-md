// End to end driver: it boots the real app (WIRED_E2E=1), drives the renderer
// through real keyboard events and DOM calls, and prints PASS/FAIL per check.
// Exit code is 0 only when everything is green.
//
//   npm test
//   $env:WIRED_E2E='1'; npx electron . examples\demo.md
//
// The checks live in checks/NN-name.js and run in file name order. Each module
// exports `run(ctx)` and calls ctx.check(...) once per assertion.
//
// TRAP kept from the first version: webContents.executeJavaScript AWAITS the
// promise the code returns, so calling an async renderer function must go as
// `void f()`, otherwise the test hangs with no FAIL at all.

const fs = require('fs');
const path = require('path');

const CHECKS_DIR = path.join(__dirname, 'checks');

function createContext({ window: win, app, filePath }) {
  const results = [];

  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log('[e2e] ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + detail : ''));
  };

  // A real key press through the OS input queue (the renderer listens in the
  // capture phase, because Vditor swallows keydown inside the editor).
  const key = (keyCode, modifiers) => {
    win.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: modifiers || [] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifiers || [] });
  };

  const type = async (text, delay) => {
    for (const ch of text) {
      win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await sleep(delay === undefined ? 60 : delay);
    }
  };

  const userDir = (...parts) => path.join(app.getPath('userData'), ...parts);

  const readJson = (p) => {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  };

  const readConfigFile = () => readJson(userDir('config.json'));

  // The xterm buffer as plain text.
  const termBuffer = () =>
    js(`(function(){var out=[];for(var i=0;i<xterm.buffer.active.length;i++){var l=xterm.buffer.active.getLine(i);if(l)out.push(l.translateToString(true));}return out.join('\\n');})()`);

  // Waits for the terminal buffer to satisfy `done`, or (when `done` is not
  // given) to grow and then stay still. Same shape as the wait the AI bridge
  // already does at runtime: sleeping a fixed amount is what made the terminal
  // check flaky, because shell start up time varies wildly per machine.
  const waitTerminal = async (done, opts) => {
    const o = Object.assign({ ceiling: 40000, stableFor: 900, minimum: 800, step: 250 }, opts || {});
    const started = Date.now();
    let last = '';
    let stableSince = Date.now();
    let buf = '';
    while (Date.now() - started < o.ceiling) {
      await sleep(o.step);
      buf = await termBuffer();
      if (buf !== last) {
        last = buf;
        stableSince = Date.now();
      }
      if (typeof done === 'function') {
        if (done(buf)) return buf;
        continue;
      }
      if (Date.now() - started >= o.minimum && Date.now() - stableSince >= o.stableFor && buf !== '') return buf;
    }
    return buf;
  };

  // Closes any pane whose path contains one of the keys and drops the matching
  // entries from Recents. Every artifact producing check ends with this.
  const forget = async (keys) => {
    const list = JSON.stringify(keys);
    await js(
      `(function(){var keys=${list};keys.forEach(function(k){var p=panes.find(function(x){return x.path&&x.path.indexOf(k)!==-1;});if(p){setPaneDirty(p,false);closePane(p);}});config.recentFiles=config.recentFiles.filter(function(r){return !keys.some(function(k){return r.indexOf(k)!==-1;});});saveConfig();renderRecents();})()`
    );
    await sleep(400);
  };

  const openPath = async (p, side) => {
    await js(`void openPath(${JSON.stringify(p)}, ${side ? 'true' : 'false'})`);
    await sleep(side ? 1200 : 700);
  };

  const demoPath = filePath;
  const rootDir = demoPath ? path.dirname(demoPath) : process.cwd();

  return {
    win,
    app,
    fs,
    path,
    js,
    key,
    type,
    sleep,
    check,
    results,
    userDir,
    readJson,
    readConfigFile,
    termBuffer,
    waitTerminal,
    forget,
    openPath,
    demoPath,
    rootDir,
    fixtures: {
      demo: demoPath,
      skill: path.join(rootDir, 'example-skill.md'),
      notes: path.join(rootDir, 'notes.md')
    },
    // Filled in by 04-terminal so the report can name the backend in use.
    state: {}
  };
}

async function run({ window: win, app, filePath }) {
  const ctx = createContext({ window: win, app, filePath });
  try {
    await ctx.sleep(3000);
    const files = fs
      .readdirSync(CHECKS_DIR)
      .filter((f) => /^\d+-.*\.js$/.test(f))
      .sort();
    for (const f of files) {
      const mod = require(path.join(CHECKS_DIR, f));
      await mod.run(ctx);
    }
  } catch (err) {
    ctx.check('e2e ran without an exception', false, err && err.stack ? err.stack.split('\n')[0] : String(err));
  }
  const fails = ctx.results.filter((r) => !r.ok).length;
  console.log('[e2e] total=' + ctx.results.length + ' failures=' + fails);
  app.exit(fails === 0 ? 0 : 1);
}

module.exports = { run };
