// A line diff of two texts, for the read only diff overlay. Edits to a note are
// local (an agent rewrites a section, not every line), so the common head and
// tail are trimmed first and only the middle runs the LCS table. A middle too big
// for the table falls back to "all of the old out, all of the new in", which is
// still a true diff, just not a minimal one.

const MAX_CELLS = 4_000_000;

export function diffLines(oldText, newText) {
  const a = String(oldText).replace(/\r\n/g, '\n').split('\n');
  const b = String(newText).replace(/\r\n/g, '\n').split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const out = a.slice(0, head).map((text) => ({ type: 'ctx', text }));
  if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    for (const text of midA) out.push({ type: 'del', text });
    for (const text of midB) out.push({ type: 'add', text });
  } else {
    // lcs[i][j]: length of the common subsequence of midA[i..] and midB[j..].
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ type: 'ctx', text: midA[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        out.push({ type: 'del', text: midA[i++] });
      } else {
        out.push({ type: 'add', text: midB[j++] });
      }
    }
    while (i < n) out.push({ type: 'del', text: midA[i++] });
    while (j < m) out.push({ type: 'add', text: midB[j++] });
  }
  for (const text of a.slice(a.length - tail)) out.push({ type: 'ctx', text });
  return out;
}

// Keeps `context` unchanged lines around each change and folds every longer
// run of unchanged lines into one "..." row, so a change in a long note is not
// a needle in the whole file.
export function foldContext(lines, context = 3) {
  const near = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.type === 'ctx') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) near[k] = true;
  });
  const out = [];
  let folded = false;
  lines.forEach((l, i) => {
    if (l.type !== 'ctx' || near[i]) {
      out.push(l);
      folded = false;
    } else if (!folded) {
      out.push({ type: 'ctx', text: '...' });
      folded = true;
    }
  });
  return out;
}
