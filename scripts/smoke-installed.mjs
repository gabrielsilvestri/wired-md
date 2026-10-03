// Smoke test for an INSTALLED build (`npm run dist`, then the NSIS installer).
//
//   node scripts/smoke-installed.mjs "C:\Users\<you>\AppData\Local\Programs\wired-md\wired-md.exe"
//
// The E2E suite drives the app from inside the main process (tests/ is required
// behind an env var), and tests/ deliberately does not ship in the installer. So
// this script drives the installed app from OUTSIDE, over the Chrome DevTools
// Protocol: it launches the exe with --remote-debugging-port, connects to the
// renderer target and evaluates the same window surface the E2E uses.
//
// What it proves is exactly what packaging can break and unit tests cannot see:
// the window opens at the right size, the note on the command line renders, the
// %APPDATA% seeding still works when the source folders live inside app.asar,
// ripgrep runs from app.asar.unpacked, and node-pty loads its prebuilt binary.

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) {
  console.error('usage: node scripts/smoke-installed.mjs <path to the installed wired-md.exe>');
  process.exit(2);
}

const PORT = Number(process.env.WIRED_CDP_PORT || 9333);
const profile = process.env.WIRED_USERDATA || path.join(os.tmpdir(), 'wired-installed-smoke-' + Date.now());
const sample = path.join(profile, 'sample-note.md');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log('[installed] ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  sample,
  ['# installed smoke', '', 'A line with the marker word koalabear in it.', '', 'From R$297 to R$ 397 stays money.', ''].join('\n'),
  'utf8'
);

// Same occlusion switch the E2E modes set from inside: this window spends the
// whole run covered by the terminal that launched it, and Chromium stops
// rendering an occluded window on Windows.
const launchedAt = Date.now();
const child = spawn(exe, ['--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', sample], {
  env: Object.assign({}, process.env, { WIRED_USERDATA: profile }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let appOut = '';
child.stdout.on('data', (d) => (appOut += d.toString('utf8')));
child.stderr.on('data', (d) => (appOut += d.toString('utf8')));

async function findTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  return null;
}

// Minimal CDP client on the WebSocket that ships with Node 22.
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      slot(msg);
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () =>
      resolve({
        send: (method, params) =>
          new Promise((res) => {
            const mid = ++id;
            pending.set(mid, res);
            ws.send(JSON.stringify({ id: mid, method, params }));
          }),
        close: () => ws.close()
      })
    );
  });
}

async function main() {
  const target = await findTarget();
  if (!target) {
    check('the installed app exposes a renderer target', false, appOut.slice(-800));
    return;
  }
  const cdp = await connect(target.webSocketDebuggerUrl);

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    if (r.result && r.result.result && 'value' in r.result.result) return r.result.result.value;
    return null;
  };

  // The boot is async (config, theme, snippets, then the file from argv).
  // Polled tightly, so the time to a rendered note is a number worth logging:
  // a fast start is a feature, and a regression should be visible here.
  for (let i = 0; i < 300; i++) {
    const p = await evaluate('(function(){try{var a=activePane();return a&&a.path&&a.ready&&document.querySelector("#panes .pane.active .vditor-ir h1")?a.path:null;}catch(e){return null;}})()');
    if (p) break;
    await sleep(100);
  }
  console.log('[installed] launch to a rendered note: ' + (Date.now() - launchedAt) + ' ms');

  const win = await evaluate('({w:window.outerWidth,h:window.outerHeight,frameless:!!document.getElementById("titlebar")})');
  // A pixel either way is display scaling rounding, not a different window.
  const near = (a, b) => typeof a === 'number' && Math.abs(a - b) <= 2;
  check('frameless window opens at the 700x840 default', !!win && near(win.w, 700) && near(win.h, 840) && win.frameless, win);

  const doc = await evaluate(
    '(function(){var p=activePane();return {path:p&&p.path,text:p&&p.vditor?p.vditor.getValue():null,h1:!!document.querySelector("#panes .pane.active .vditor-ir h1")};})()'
  );
  check(
    'the .md from the command line is open and rendered',
    !!doc && typeof doc.path === 'string' && doc.path.toLowerCase() === sample.toLowerCase() && !!doc.text && doc.text.includes('koalabear') && doc.h1 === true,
    doc && { path: doc.path, h1: doc.h1 }
  );

  const seeded = ['themes', 'snippets', 'templates'].map((d) => {
    const dir = path.join(profile, d);
    return { dir: d, files: fs.existsSync(dir) ? fs.readdirSync(dir).length : 0 };
  });
  check(
    'themes, snippets and templates were seeded into the fresh profile from inside app.asar',
    seeded.every((s) => s.files > 0) && fs.existsSync(path.join(profile, 'themes', 'wired.css')),
    seeded
  );

  const search = await evaluate(
    '(async()=>{var r=await window.wired.searchFolder(' + JSON.stringify(profile) + ',"koalabear");return {ok:r.ok,engine:r.engine,total:r.total};})()'
  );
  check(
    'full text search answers over IPC with the ripgrep binary from app.asar.unpacked',
    !!search && search.ok === true && search.engine === 'ripgrep' && search.total >= 1,
    search
  );

  const term = await evaluate('(async()=>{var r=await window.wired.termStart(' + JSON.stringify(profile) + ',80,20);return r;})()');
  check('the embedded terminal starts (node-pty, or the pipe fallback)', !!term && term.ok === true, term);
  check('the terminal backend is the native node-pty, not the fallback', !!term && term.kind === 'pty', term && term.kind);

  // What packaging can break in the features that came later: the theme
  // catalog read out of app.asar, the first run welcome in a real profile, the
  // recovery folder and the CLAUDE.md import walk, all over IPC.
  const catalog = await evaluate('(async()=>{var c=await window.wired.listCatalogThemes();return c.map(function(t){return t.name;});})()');
  check('the theme gallery reads its ten catalog themes out of app.asar', Array.isArray(catalog) && catalog.length >= 10, catalog);

  const welcome = await evaluate('(function(){var o=document.getElementById("onboarding-overlay");return !!o&&!o.classList.contains("hidden");})()');
  check('a fresh profile opens the first run welcome on its own (no test gate here)', welcome === true, welcome);

  const recovery = await evaluate('(async()=>{await window.wired.recoverySave("smoke:key",{path:null,content:"kept"});var l=await window.wired.recoveryList();await window.wired.recoveryDrop("smoke:key");var after=await window.wired.recoveryList();return {saved:l.some(function(e){return e.key==="smoke:key"&&e.content==="kept";}),dropped:!after.some(function(e){return e.key==="smoke:key";})};})()');
  check('recovery snapshots are written to and removed from the profile', !!recovery && recovery.saved && recovery.dropped, recovery);

  fs.writeFileSync(path.join(profile, 'imported.md'), 'imported text\n', 'utf8');
  const imports = await evaluate('(async()=>{var r=await window.wired.scanImports(' + JSON.stringify(path.join(profile, 'CLAUDE.md')) + ',"see @imported.md");return {n:r.items.length,exists:r.items[0]&&r.items[0].exists};})()');
  check('the CLAUDE.md import walk resolves a file next to the note', !!imports && imports.n === 1 && imports.exists === true, imports);

  await evaluate('(async()=>{await window.wired.termKill();})()');
  await cdp.send('Runtime.evaluate', { expression: 'window.wired.winClose()' });
  cdp.close();
}

main()
  .catch((err) => check('the smoke ran without an exception', false, String(err && err.stack ? err.stack : err)))
  .then(async () => {
    await sleep(1500);
    try {
      child.kill();
    } catch {}
    const fails = results.filter((r) => !r.ok).length;
    console.log('[installed] total=' + results.length + ' failures=' + fails);
    console.log('[installed] profile=' + profile);
    process.exit(fails === 0 ? 0 : 1);
  });
