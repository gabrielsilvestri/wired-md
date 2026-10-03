// The AI bridge honors the configured CLI (`aiCliCommand`) and STILL never
// presses Enter on the final prompt line. That last part is the product rule:
// spending a token is the owner's call, whichever CLI is configured.
//
// The config key is written and reset here on purpose (the trap: a check that
// reads config.json state has to own that state, because the suite runs against
// a real profile).

const FAKE = 'wired-e2e-fake-cli';

async function run(ctx) {
  const { js, check, sleep, waitTerminal, readConfigFile } = ctx;

  const previous = await js('config.aiCliCommand');
  await js(`void (async function(){config.aiCliCommand=${JSON.stringify(FAKE)};await saveConfig();applyCustom();})()`);
  await sleep(500);

  const labels = await js(
    `(function(){var b=document.querySelector('.pane-header .pane-claude');var t=document.getElementById('btn-claude');` +
      `return {paneTip:b?b.title:null,termText:t?t.textContent:null,termTip:t?t.title:null,cfg:config.aiCliCommand,` +
      `noEnterInSource:true};})()`
  );
  const onDisk = readConfigFile();
  check(
    'ai bridge: the configured command reaches the tooltips and config.json',
    !!labels && (labels.paneTip || '').indexOf(FAKE) !== -1 && labels.termText === FAKE &&
      (labels.termTip || '').indexOf(FAKE) !== -1 && !!onDisk && onDisk.aiCliCommand === FAKE,
    JSON.stringify({ labels, disk: onDisk ? onDisk.aiCliCommand : null })
  );

  // The full bridge run, with a command that does not exist: the shell answers
  // that it does not know it, which is exactly the "the TUI settled" signal the
  // bridge polls for, so the flow reaches the prompt line the same way.
  await js('toggleTerminal(true)');
  await waitTerminal(undefined, { ceiling: 30000 });
  // Whatever an earlier check left in the active pane is the note the bridge
  // will quote, so the assertion asks the app which file that is.
  const notePath = await js('currentPath');
  const noteTail = String(notePath).split(/[\\/]/).pop() + '"';
  await js('void sendFileToClaude()');

  const squeeze = (s) => s.replace(/\s+/g, '');
  const buf = await waitTerminal((b) => squeeze(b).indexOf(noteTail) !== -1, { ceiling: 40000 });
  const flat = squeeze(buf);

  const typedCommand = flat.indexOf(squeeze(FAKE)) !== -1;
  // With no Enter, the quoted path is still sitting on the LAST line with
  // content: nothing was executed after it.
  const lines = buf.split('\n').map((l) => l.replace(/\s+$/, ''));
  let lastIdx = lines.length - 1;
  while (lastIdx > 0 && lines[lastIdx].trim() === '') lastIdx--;
  const tail = squeeze(lines.slice(Math.max(0, lastIdx - 2), lastIdx + 1).join(''));
  const promptStillOpen = tail.indexOf(noteTail) !== -1;

  // The folder change is a shell cd typed BEFORE the CLI, never Claude Code's
  // own /cd typed into whichever CLI is configured.
  const noteDir = String(notePath).replace(/[\\/][^\\/]*$/, '');
  const cdAt = flat.indexOf(squeeze("Set-Location -LiteralPath '" + noteDir.replace(/'/g, "''") + "'"));
  check(
    'ai bridge: the shell changes into the note folder before the CLI starts, with no slash command typed into the CLI',
    cdAt !== -1 && cdAt < flat.indexOf(squeeze(FAKE)) && flat.indexOf('/cd') === -1,
    JSON.stringify({ cdAt, cliAt: flat.indexOf(squeeze(FAKE)) })
  );
  check(
    'ai bridge: it types the configured command and leaves the note path on the prompt WITHOUT Enter',
    typedCommand && promptStillOpen,
    JSON.stringify({ typedCommand, promptStillOpen, tail: tail.slice(-90) })
  );

  // Reset, so the next run (and the owner's own profile) is unchanged.
  await js(`void (async function(){config.aiCliCommand=${JSON.stringify(previous || 'claude')};await saveConfig();applyCustom();})()`);
  await sleep(400);
}

module.exports = { run };
