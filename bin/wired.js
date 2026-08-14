#!/usr/bin/env node
// wired: drive the running wired-md editor from a terminal (EXPERIMENTAL).
//
//   wired open <file>                 open the file in the editor (starts it if needed)
//   wired focus <file>                bring a file that is already open to the front
//   wired list [--json]               the files the editor has open
//   wired new [--template t] [--title x]   create a note and open it
//
// TRANSPORT, and why it looks like this: there is no daemon, no server and no
// port. Launching the app again is the message. Electron's single instance lock
// makes the second process hand its argv to the live window and die, which is
// exactly a one shot RPC that costs no background process and cannot be left
// listening on a socket by accident. A command with an answer passes the path of
// a reply file that the live instance writes and this script polls.
//
// Philosophy for an AI agent driving this: EDIT THE FILES ON DISK DIRECTLY. The
// editor watches the folder and picks the change up. This CLI is only for
// opening, focusing and creating, never for pushing content.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_ROOT = path.join(__dirname, '..');
const cli = require(path.join(APP_ROOT, 'src', 'main', 'cli.js'));

function userDataDir() {
  if (process.env.WIRED_USERDATA) return path.resolve(process.env.WIRED_USERDATA);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'wired-md');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'wired-md');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'wired-md');
}

// Is an instance live in this profile? The marker file is written on ready and
// removed on quit, so a stale one only means one extra Electron start up.
function isRunning() {
  try {
    const raw = JSON.parse(fs.readFileSync(cli.instanceFile(userDataDir()), 'utf8'));
    process.kill(raw.pid, 0); // signal 0 only tests whether the pid is alive
    return true;
  } catch {
    return false;
  }
}

function usage(code) {
  console.log(
    [
      'wired (experimental) drives a running wired-md window.',
      '',
      '  wired open <file>                      open a .md in the editor',
      '  wired focus <file>                     focus a file already open',
      '  wired list [--json]                    list the open files',
      '  wired new [--template <name>] [--title <title>]',
      '',
      'The editor watches the folder: to CHANGE a note, write the file on disk.',
      'This CLI never sends content.'
    ].join('\n')
  );
  process.exit(code);
}

function parseFlags(args) {
  const out = { _: [], json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') out.json = true;
    else if (a === '--template') out.template = args[++i];
    else if (a === '--title') out.title = args[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else out._.push(a);
  }
  return out;
}

function electronBinary() {
  try {
    return require(path.join(APP_ROOT, 'node_modules', 'electron'));
  } catch {
    return null;
  }
}

// Hands the payload to the live instance (or starts one). Returns the child so
// the caller can decide whether to wait for it.
function dispatch(cmd) {
  const electron = electronBinary();
  if (!electron) {
    console.error('wired: could not find the electron binary. Run npm install in ' + APP_ROOT + '.');
    process.exit(1);
  }
  // ELECTRON_RUN_AS_NODE has to go: this script may itself be running under it,
  // and inheriting it would turn the app we are launching into a bare node
  // process with no window and no single instance lock.
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [APP_ROOT, cli.encodeCommand(cmd)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env
  });
  child.unref();
  return child;
}

// Polls the reply file the live instance writes. Short waits when the app is
// already up, a long one when this call had to boot it.
function waitForReply(file, ceiling) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        if (raw) {
          try {
            fs.unlinkSync(file);
          } catch {}
          resolve(JSON.parse(raw));
          return;
        }
      } catch {}
      if (Date.now() - started > ceiling) {
        resolve(null);
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

function replyPath() {
  return path.join(os.tmpdir(), 'wired-cli-' + process.pid + '-' + Date.now() + '.json');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage(0);
  const command = argv[0];
  const flags = parseFlags(argv.slice(1));
  if (flags.help) usage(0);

  const running = isRunning();
  const cwd = process.cwd();
  const reply = replyPath();

  if (command === 'open') {
    const file = flags._[0];
    if (!file) usage(1);
    const abs = path.resolve(cwd, file);
    if (!fs.existsSync(abs)) {
      console.error('wired: file not found: ' + abs);
      process.exit(1);
    }
    dispatch({ cmd: 'open', file: abs, cwd, reply });
    const res = await waitForReply(reply, running ? 25000 : 45000);
    if (res && res.ok === false) {
      console.error('wired: ' + res.error);
      process.exit(1);
    }
    console.log(abs);
    return;
  }

  if (command === 'focus' || command === 'list' || command === 'new') {
    if (!running) {
      console.error('wired: no editor running in this profile. Use "wired open <file>" to start one.');
      process.exit(1);
    }
  }

  if (command === 'focus') {
    const file = flags._[0];
    if (!file) usage(1);
    dispatch({ cmd: 'focus', file: path.resolve(cwd, file), cwd, reply });
    const res = await waitForReply(reply, 25000);
    if (!res || res.ok === false) {
      console.error('wired: ' + ((res && res.error) || 'no answer from the editor'));
      process.exit(1);
    }
    console.log(res.focused);
    return;
  }

  if (command === 'list') {
    dispatch({ cmd: 'list', cwd, reply });
    const res = await waitForReply(reply, 25000);
    if (!res || res.ok === false) {
      console.error('wired: ' + ((res && res.error) || 'no answer from the editor'));
      process.exit(1);
    }
    if (flags.json) {
      console.log(JSON.stringify(res.files, null, 2));
      return;
    }
    for (const f of res.files) {
      if (!f.path) continue;
      console.log((f.active ? '* ' : '  ') + (f.dirty ? '~ ' : '  ') + f.path);
    }
    return;
  }

  if (command === 'new') {
    dispatch({ cmd: 'new', template: flags.template || null, title: flags.title || 'untitled', cwd, reply });
    const res = await waitForReply(reply, 25000);
    if (!res || res.ok === false) {
      console.error('wired: ' + ((res && res.error) || 'no answer from the editor'));
      process.exit(1);
    }
    console.log(res.created);
    return;
  }

  usage(1);
}

main().catch((err) => {
  console.error('wired: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
