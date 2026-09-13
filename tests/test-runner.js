const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { prepareEnvironment, cleanupProfile } = require('../scripts/test');

test('end to end mode isolates its profile and removes conflicting test flags', () => {
  const run = prepareEnvironment({
    ELECTRON_RUN_AS_NODE: '1',
    WIRED_SMOKE: '1'
  }, false);

  assert.strictEqual(run.env.WIRED_E2E, '1');
  assert.strictEqual(run.env.WIRED_SMOKE, undefined);
  assert.strictEqual(run.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.strictEqual(run.ownsProfile, true);
  assert.strictEqual(path.dirname(run.profile), os.tmpdir());
  assert.strictEqual(fs.existsSync(run.profile), true);

  cleanupProfile(run);
  assert.strictEqual(fs.existsSync(run.profile), false);
});

test('smoke mode preserves an explicit profile and never removes it', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wired-md-explicit-'));
  const marker = path.join(profile, 'keep.txt');
  fs.writeFileSync(marker, 'keep');

  try {
    const run = prepareEnvironment({
      WIRED_USERDATA: profile,
      WIRED_E2E: '1',
      ELECTRON_RUN_AS_NODE: '1'
    }, true);

    assert.strictEqual(run.env.WIRED_USERDATA, profile);
    assert.strictEqual(run.env.WIRED_SMOKE, '1');
    assert.strictEqual(run.env.WIRED_E2E, undefined);
    assert.strictEqual(run.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.strictEqual(run.ownsProfile, false);

    cleanupProfile(run);
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'keep');
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('an explicit relative profile is resolved before Electron changes cwd', () => {
  const invocationCwd = path.join(os.tmpdir(), 'wired-md-invocation');
  const run = prepareEnvironment({ WIRED_USERDATA: 'saved-profile' }, false, invocationCwd);

  assert.strictEqual(run.env.WIRED_USERDATA, path.join(invocationCwd, 'saved-profile'));
  assert.strictEqual(run.profile, path.join(invocationCwd, 'saved-profile'));
  assert.strictEqual(run.ownsProfile, false);
});
