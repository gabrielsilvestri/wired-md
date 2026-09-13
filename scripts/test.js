// Cross platform runner for the automated suites, so the npm scripts work the
// same in PowerShell, cmd and a POSIX shell (a bare `WIRED_E2E=1 npx electron .`
// is a parse error in PowerShell).
//
//   node scripts/test.js          end to end suite
//   node scripts/test.js --smoke  smoke test
//
// WIRED_USERDATA can select a persistent profile for debugging. Otherwise this
// runner creates an isolated temporary profile and removes it when Electron
// exits.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function prepareEnvironment(source, smoke, invocationCwd) {
  const env = Object.assign({}, source);
  delete env.ELECTRON_RUN_AS_NODE;

  if (smoke) {
    env.WIRED_SMOKE = '1';
    delete env.WIRED_E2E;
  } else {
    env.WIRED_E2E = '1';
    delete env.WIRED_SMOKE;
  }

  if (env.WIRED_USERDATA) {
    const profile = path.resolve(invocationCwd || process.cwd(), env.WIRED_USERDATA);
    env.WIRED_USERDATA = profile;
    return { env, profile, ownsProfile: false };
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wired-md-test-'));
  env.WIRED_USERDATA = profile;
  return { env, profile, ownsProfile: true };
}

function cleanupProfile(run) {
  if (!run.ownsProfile) return;
  try {
    fs.rmSync(run.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {
    console.error('could not remove temporary test profile: ' + err.message);
  }
}

function main() {
  const smoke = process.argv.includes('--smoke');
  const root = path.join(__dirname, '..');
  const electron = require('electron'); // resolves to the executable path
  const run = prepareEnvironment(process.env, smoke);
  const args = ['.'];
  if (!smoke) args.push(path.join('examples', 'demo.md'));

  let child;
  try {
    child = spawn(electron, args, {
      cwd: root,
      env: run.env,
      stdio: 'inherit',
      windowsHide: true
    });
  } catch (err) {
    cleanupProfile(run);
    console.error('could not start electron: ' + err.message);
    process.exit(1);
  }

  let launchError = false;
  child.on('error', (err) => {
    launchError = true;
    console.error('could not start electron: ' + err.message);
  });
  child.on('close', (code) => {
    cleanupProfile(run);
    process.exit(launchError || code === null ? 1 : code);
  });
}

module.exports = { prepareEnvironment, cleanupProfile };

if (require.main === module) main();
