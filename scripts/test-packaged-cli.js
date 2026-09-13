const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.join(__dirname, '..');
const cli = require(path.join(repo, 'bin', 'wired.js'));

assert.strictEqual(cli.isPackagedCli(), false, 'source checkout must use development Electron');

if (process.platform === 'win32') {
  const pathTest = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'scripts', 'test-wired-path.ps1')], { encoding: 'utf8' });
  assert.strictEqual(pathTest.status, 0, pathTest.stderr || pathTest.stdout);
}

const cmd = require('fs').readFileSync(path.join(repo, 'packaging', 'wired.cmd'), 'utf8');
assert.match(cmd, /setlocal/i);
assert.match(cmd, /ELECTRON_RUN_AS_NODE=1/);
assert.match(cmd, /resources\\app\.asar\\bin\\wired\.js/);
assert.match(cmd, /%\*/);
assert.match(cmd, /exit \/b %errorlevel%/i);

console.log('packaged CLI checks passed');
