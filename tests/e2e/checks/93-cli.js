// The experimental CLI, driven exactly the way an AI agent would drive it: a
// separate `node bin/wired.js` process talking to THIS running instance.
//
// The transport under test: no daemon and no port. The CLI launches the app
// again, the single instance lock hands that argv to the live window, the second
// process dies, and the answer comes back through a temp file.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(APP_ROOT, 'bin', 'wired.js');

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath, // the plain node inside Electron, via ELECTRON_RUN_AS_NODE
      [BIN].concat(args),
      {
        cwd: APP_ROOT,
        timeout: 60000,
        windowsHide: true,
        env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }, env || {})
      },
      (err, stdout, stderr) => resolve({ code: err ? err.code || 1 : 0, stdout: stdout || '', stderr: stderr || '' })
    );
  });
}

async function run(ctx) {
  const { check, app, sleep, demoPath } = ctx;

  const marker = path.join(app.getPath('userData'), 'cli-instance.json');
  const bin = require(path.join(APP_ROOT, 'package.json')).bin;
  check(
    'cli: package.json declares the wired bin and the live instance left its marker file',
    !!bin && bin.wired === 'bin/wired.js' && fs.existsSync(marker),
    JSON.stringify({ bin, marker: fs.existsSync(marker) })
  );

  // The second process must NOT open a window of its own: it hands over and dies.
  const res = await runCli(['list', '--json']);
  await sleep(200);
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {}
  const paths = Array.isArray(parsed) ? parsed.map((f) => f.path).filter(Boolean) : [];
  check(
    'cli: `wired list --json` answers with the file this instance has open',
    Array.isArray(parsed) && paths.some((p) => p && p.toLowerCase() === demoPath.toLowerCase()),
    JSON.stringify({ code: res.code, stdout: res.stdout.slice(0, 300), stderr: res.stderr.slice(0, 200) })
  );

  // A profile with no instance running: focus and list fail fast instead of
  // starting an editor nobody asked for.
  const empty = path.join(app.getPath('userData'), 'cli-empty-profile');
  fs.mkdirSync(empty, { recursive: true });
  const dead = await runCli(['list'], { WIRED_USERDATA: empty });
  check(
    'cli: with no editor running in the profile, list refuses instead of opening one',
    dead.code !== 0 && /no editor running/.test(dead.stderr),
    JSON.stringify({ code: dead.code, stderr: dead.stderr.slice(0, 160) })
  );
  try {
    fs.rmSync(empty, { recursive: true, force: true });
  } catch {}
}

module.exports = { run };
