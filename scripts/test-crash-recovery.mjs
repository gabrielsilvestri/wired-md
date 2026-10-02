// A REAL crash for the recovery feature, which the E2E suite cannot do from
// inside the process it would have to kill. It launches the app from this
// checkout over the DevTools protocol (the same minimal client as
// smoke-installed.mjs), makes a note dirty, waits for the snapshot, kills the
// whole process tree, relaunches with the same profile and expects the edits
// back as an unsaved tab with the recovery note.
//
//   node scripts/test-crash-recovery.mjs
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(repo, 'node_modules/electron/dist/electron.exe');
const PORT = Number(process.env.WIRED_CDP_PORT || 9341);
const profile = path.join(os.tmpdir(), 'wired-crash-' + Date.now());
const note = path.join(profile, 'crash-note.md');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(note, '# Crash\n\nsaved on disk\n', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[crash]', ...a);

function launch(args) {
  return spawn(exe, ['.', '--remote-debugging-port=' + PORT, '--disable-features=CalculateNativeWinOcclusion', ...args], {
    cwd: repo,
    env: (() => { const e = Object.assign({}, process.env, { WIRED_USERDATA: profile }); delete e.ELECTRON_RUN_AS_NODE; return e; })(),
    stdio: 'ignore'
  });
}

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch {}
    await sleep(250);
  }
  return null;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const slot = pending.get(msg.id);
      if (slot) {
        pending.delete(msg.id);
        slot(msg);
      }
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () =>
      resolve({
        evaluate: (expression) =>
          new Promise((res) => {
            const mid = ++id;
            pending.set(mid, (r) => res(r.result && r.result.result ? r.result.result.value : null));
            ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
          }),
        close: () => ws.close()
      })
    );
  });
}

async function until(cdp, expr, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = await cdp.evaluate(expr);
    if (v) return v;
    await sleep(250);
  }
  return null;
}

const N = JSON.stringify(note);
let child = launch([note]);
let t = await target();
if (!t) {
  log('FAIL the app never exposed a renderer target');
  process.exit(1);
}
let cdp = await connect(t.webSocketDebuggerUrl);
log('opened', await until(cdp, `(function(){try{var p=panes.find(function(x){return x.path===${N}&&x.ready;});return !!p;}catch(e){return false;}})()`));
await cdp.evaluate(`(function(){var p=panes.find(function(x){return x.path===${N};});p.vditor.setValue('# Crash\\n\\nunsaved before the crash\\n');setPaneDirty(p,true);return true;})()`);
await sleep(3500);
const snaps = fs.existsSync(path.join(profile, 'recovery')) ? fs.readdirSync(path.join(profile, 'recovery')) : [];
log('snapshots after 3.5s:', snaps, snaps.map((n) => JSON.parse(fs.readFileSync(path.join(profile, 'recovery', n), 'utf8')).content));
cdp.close();
execSync('taskkill /f /t /pid ' + child.pid, { stdio: 'ignore' });
await sleep(1500);
log('disk after the crash:', JSON.stringify(fs.readFileSync(note, 'utf8')));

child = launch([]);
t = await target();
if (!t) {
  log('FAIL the relaunched app never exposed a renderer target');
  process.exit(1);
}
cdp = await connect(t.webSocketDebuggerUrl);
const back = await until(cdp, `(function(){try{var p=panes.find(function(x){return x.path===${N};});if(!p||!p.ready)return null;var s=p.el.querySelector('.pane-status');return {dirty:p.dirty,value:p.vditor.getValue(),status:s?s.textContent:''};}catch(e){return null;}})()`);
log('after relaunch:', JSON.stringify(back));
const ok = !!back && back.dirty && back.value.includes('unsaved before the crash') && /Recovered/.test(back.status);
// Spellcheck is off, so Chromium never fetched a Hunspell dictionary.
const dicts = fs.existsSync(path.join(profile, 'Dictionaries')) ? fs.readdirSync(path.join(profile, 'Dictionaries')) : [];
log(dicts.length ? 'FAIL dictionaries were downloaded: ' + dicts.join(', ') : 'PASS no spellcheck dictionary was downloaded');
log(ok ? 'PASS real crash recovery' : 'FAIL real crash recovery');
cdp.close();
execSync('taskkill /f /t /pid ' + child.pid, { stdio: 'ignore' });
try {
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch {}
process.exit(ok && !dicts.length ? 0 : 1);
