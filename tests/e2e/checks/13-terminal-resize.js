// Dragging the top edge of the terminal panel changes its height, persists it
// to config.json and respects the clamp.

async function run(ctx) {
  const { js, sleep, check, readConfigFile } = ctx;

  await js('toggleTerminal(true)');
  await sleep(600);
  // Reading height back out of config.json means starting from a known value.
  await js('setTerminalHeight(260); saveConfig();');
  await sleep(300);

  const drag = await js(
    `(function(){var panel=document.getElementById('terminal-panel');var r=panel.getBoundingClientRect();var res=document.getElementById('terminal-resizer');res.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientY:Math.round(r.top)}));window.dispatchEvent(new MouseEvent('mousemove',{clientY:Math.round(r.bottom-340)}));window.dispatchEvent(new MouseEvent('mouseup',{}));return {css:panel.style.height,cfg:config.terminalHeight};})()`
  );
  await sleep(500);
  const onDisk = readConfigFile();
  const clamp = await js(
    `(function(){setTerminalHeight(50);var min=document.getElementById('terminal-panel').style.height;setTerminalHeight(9999);var max=parseInt(document.getElementById('terminal-panel').style.height,10);setTerminalHeight(260);saveConfig();return {min:min,maxOk:max<=Math.round(window.innerHeight*0.7)};})()`
  );
  await js('toggleTerminal(false)');
  check(
    'terminal height drags to 340px, persists to config.json and respects the clamp',
    !!drag && drag.css === '340px' && drag.cfg === 340 && !!onDisk && onDisk.terminalHeight === 340 && !!clamp && clamp.min === '120px' && clamp.maxOk,
    JSON.stringify({ drag, disk: onDisk && onDisk.terminalHeight, clamp })
  );
}

module.exports = { run };
