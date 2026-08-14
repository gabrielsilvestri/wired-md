// The embedded terminal comes up in the note's folder and runs a command.
//
// This check used to be the flaky one: it slept a fixed amount and hoped the
// shell had answered. Shell start up varies by a lot on Windows (antivirus,
// cold cache, conpty), so the wait is now grow-and-stabilize polling of the
// xterm buffer with a generous ceiling, the same shape the AI bridge uses.

const { currentTerminal } = require('../../../src/main/ipc/terminal');

async function run(ctx) {
  const { js, check, waitTerminal } = ctx;

  await js('toggleTerminal(true)');
  // First wait: the shell prompt shows up (or the buffer stops growing).
  await waitTerminal((buf) => /PS .*>/.test(buf), { ceiling: 30000 });

  // xterm wraps long names at the edge of the line (terminal width depends on
  // the sidebar), so the match ignores whitespace entirely.
  const hasDemo = (s) => /demo\.md/.test(s.replace(/\s+/g, ''));
  await js(`window.wired.termInput('dir\\r')`);
  const buf = await waitTerminal(hasDemo, { ceiling: 30000 });

  const term = currentTerminal();
  check(
    'terminal (' + (term ? term.kind : 'none') + ') ran dir and listed demo.md',
    hasDemo(buf),
    hasDemo(buf) ? 'demo.md in the buffer' : 'no match'
  );
}

module.exports = { run };
