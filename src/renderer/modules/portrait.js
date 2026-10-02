// The Lain portrait of the empty state, drawn from its braille text.
//
// The art in index.html is braille (U+2800 to U+28FF): every character is a
// 2 by 4 grid of dots. No font on a stock Windows draws that block at one
// advance width (in Segoe UI Symbol the blank cell is narrower than a dense
// one), so as text the rows sheared by up to 40px. Each character is instead
// decoded into its dots and drawn as one SVG path in currentColor, which keeps
// the grid exact and follows the theme with no redraw. The <pre> stays the
// source of truth for the art and is hidden once the drawing exists.

// Bit of each dot in the code point, by [column][row] inside the cell.
const DOT_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80]
];

// Pitch of the dot grid and the size of one dot, in px. A braille cell is
// 2 dots wide and 4 tall, so the 74 by 37 cell art is about 148 by 148 dots.
const PITCH = 2.6;
const DOT = 1.6;

export function brailleDots(text) {
  const dots = [];
  const lines = text.split('\n');
  lines.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      const bits = ch.codePointAt(0) - 0x2800;
      if (bits <= 0 || bits > 0xff) return;
      for (let x = 0; x < 2; x++) {
        for (let y = 0; y < 4; y++) {
          if (bits & DOT_BITS[x][y]) dots.push([col * 2 + x, row * 4 + y]);
        }
      }
    });
  });
  const cols = Math.max(...lines.map((l) => [...l].length)) * 2;
  return { dots, cols, rows: lines.length * 4 };
}

function drawPortrait() {
  const pre = document.getElementById('lain-art');
  if (!pre) return;
  const { dots, cols, rows } = brailleDots(pre.textContent);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'lain-portrait';
  svg.setAttribute('viewBox', `0 0 ${cols * PITCH} ${rows * PITCH}`);
  svg.setAttribute('width', String(cols * PITCH));
  svg.setAttribute('height', String(rows * PITCH));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', dots.map(([x, y]) => `M${(x * PITCH).toFixed(1)} ${(y * PITCH).toFixed(1)}h${DOT}v${DOT}h-${DOT}z`).join(''));
  svg.appendChild(path);
  pre.after(svg);
  pre.hidden = true;
}

drawPortrait();
