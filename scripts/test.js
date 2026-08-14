// Cross platform runner for the automated suites, so the npm scripts work the
// same in PowerShell, cmd and a POSIX shell (a bare `WIRED_E2E=1 npx electron .`
// is a parse error in PowerShell).
//
//   node scripts/test.js          end to end suite (59 checks)
//   node scripts/test.js --smoke  smoke test
//
// Setting the environment variables by hand still works and is unchanged.

const { spawn } = require('child_process');
const path = require('path');

const smoke = process.argv.includes('--smoke');
const root = path.join(__dirname, '..');
const electron = require('electron'); // resolves to the executable path

const env = Object.assign({}, process.env);
if (smoke) env.WIRED_SMOKE = '1';
else env.WIRED_E2E = '1';

const args = ['.'];
if (!smoke) args.push(path.join('examples', 'demo.md'));

const child = spawn(electron, args, { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code === null ? 1 : code));
child.on('error', (err) => {
  console.error('could not start electron: ' + err.message);
  process.exit(1);
});
