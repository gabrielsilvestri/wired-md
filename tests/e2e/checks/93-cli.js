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

  // `wired export` renders a note through this window: a PDF next to it by
  // default, an HTML page with --html --out.
  const note = path.join(app.getPath('userData'), 'cli-export.md');
  fs.writeFileSync(note, '---\nname: hidden\n---\n# CLI export\n\nRendered by the editor.\n', 'utf8');
  const pdf = note.replace(/\.md$/, '.pdf');
  const htmlOut = path.join(app.getPath('userData'), 'cli-export-page.html');
  const ex1 = await runCli(['export', note]);
  const head = fs.existsSync(pdf) ? fs.readFileSync(pdf).subarray(0, 5).toString('latin1') : '';
  const ex2 = await runCli(['export', note, '--html', '--out', htmlOut]);
  const page = fs.existsSync(htmlOut) ? fs.readFileSync(htmlOut, 'utf8') : '';
  check(
    'cli: `wired export` writes a PDF next to the note, and --html --out a page where asked, frontmatter left out',
    ex1.code === 0 && ex1.stdout.trim() === pdf && head === '%PDF-' &&
      ex2.code === 0 && /<h1[^>]*>CLI export<\/h1>/.test(page) && page.indexOf('name: hidden') === -1,
    JSON.stringify({ ex1: ex1.stdout.trim() || ex1.stderr.slice(0, 160), head, ex2: ex2.stdout.trim() || ex2.stderr.slice(0, 160) })
  );
  // An agent rewrites the open note and exports right away: what is on disk is
  // what gets rendered. An existing output needs --force, and the note itself
  // can never be the output.
  fs.writeFileSync(note, '# CLI export\n\nWritten a moment ago by an agent.\n', 'utf8');
  const ex3 = await runCli(['export', note, '--html', '--out', htmlOut]);
  const ex4 = await runCli(['export', note, '--html', '--out', htmlOut, '--force']);
  const fresh = fs.existsSync(htmlOut) ? fs.readFileSync(htmlOut, 'utf8') : '';
  const ex5 = await runCli(['export', note, '--html', '--out', note, '--force']);
  check(
    'cli: `wired export` renders the disk text, refuses an existing output without --force, and never writes over the note',
    ex3.code !== 0 && /already exists/.test(ex3.stderr) && ex4.code === 0 && fresh.indexOf('Written a moment ago by an agent.') !== -1 &&
      ex5.code !== 0 && /overwrite the note itself/.test(ex5.stderr) && fs.readFileSync(note, 'utf8').startsWith('# CLI export'),
    JSON.stringify({ ex3: ex3.stderr.slice(0, 120), ex4: ex4.code, ex5: ex5.stderr.slice(0, 120) })
  );
  await ctx.forget(['cli-export.md']);
  for (const f of [note, pdf, htmlOut]) fs.rmSync(f, { force: true, maxRetries: 10, retryDelay: 200 });
  await ctx.openPath(demoPath);

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
