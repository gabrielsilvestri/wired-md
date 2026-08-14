// Document font zoom: Ctrl+= grows it (persisted), Ctrl+0 goes back to 15.

async function run(ctx) {
  const { js, sleep, check, readConfigFile } = ctx;

  await js('setFontZoom(15)'); // deterministic starting point: the real config may hold anything
  await sleep(300);
  await js(`(function(){window.dispatchEvent(new KeyboardEvent('keydown',{key:'=',ctrlKey:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'=',ctrlKey:true}));})()`);
  await sleep(500);
  const up = await js(`(function(){return {cfg:config.fontSize,css:getComputedStyle(document.documentElement).getPropertyValue('--font-size-body').trim()};})()`);
  const onDisk = readConfigFile();
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true}))`);
  await sleep(400);
  const reset = await js('config.fontSize');
  check(
    'zoom: Ctrl+= raises the font to 17 (persisted) and Ctrl+0 goes back to 15',
    !!up && up.cfg === 17 && up.css === '17px' && !!onDisk && onDisk.fontSize === 17 && reset === 15,
    JSON.stringify({ up, disk: onDisk && onDisk.fontSize, reset })
  );
}

module.exports = { run };
