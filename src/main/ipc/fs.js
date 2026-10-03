// File IPC: read and write the open note, the open/save dialogs, and the file
// operations behind the sidebar toolbar and context menu.

const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Writes a rendered note: the page as is, or printed to PDF by a hidden window
// with no script. Shared by the palette export and `wired export`.
async function writeRendered(kind, html, filePath) {
  if (kind === 'html') {
    fs.writeFileSync(filePath, String(html), 'utf8');
    return;
  }
  // The page goes through a temp file: a data: URL of a long note is huge,
  // and relative image paths already became file URLs in the editor.
  const tmp = path.join(os.tmpdir(), 'wired-export-' + process.pid + '-' + Date.now() + '.html');
  fs.writeFileSync(tmp, String(html), 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } });
    fs.writeFileSync(filePath, pdf);
  } finally {
    win.destroy();
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
  }
}

function register({ getWindow }) {
  ipcMain.handle('dialog:open', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Open markdown',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:saveAs', async (_ev, suggestedPath) => {
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Save as',
      defaultPath: suggestedPath || 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });

  ipcMain.handle('file:read', async (_ev, filePath) => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return { ok: true, content };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('file:write', async (_ev, filePath, content) => {
    try {
      fs.writeFileSync(filePath, content, 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('fs:showInFolder', (_ev, p) => {
    try {
      if (fs.statSync(p).isDirectory()) shell.openPath(p);
      else shell.showItemInFolder(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('fs:createFile', (_ev, p) => {
    try {
      fs.writeFileSync(p, '', { flag: 'wx' });
      return { ok: true, path: p };
    } catch (err) {
      return { ok: false, error: err.code === 'EEXIST' ? 'a file with that name already exists' : String(err.message || err) };
    }
  });

  ipcMain.handle('fs:createDir', (_ev, p) => {
    try {
      if (fs.existsSync(p)) return { ok: false, error: 'a folder with that name already exists' };
      fs.mkdirSync(p);
      return { ok: true, path: p };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('fs:rename', (_ev, from, to) => {
    try {
      if (fs.existsSync(to)) return { ok: false, error: 'an item with that name already exists' };
      fs.renameSync(from, to);
      return { ok: true, path: to };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  // Deleting always goes to the system Recycle Bin (shell.trashItem), never a
  // straight unlink: a note the user wrote is never destroyed by this app.
  ipcMain.handle('fs:trash', async (_ev, p) => {
    try {
      await shell.trashItem(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  // Duplicates the file next to the original, with a "copy" suffix (numbered if
  // that name is taken too).
  ipcMain.handle('fs:duplicate', (_ev, p) => {
    try {
      const dir = path.dirname(p);
      const ext = path.extname(p);
      const base = path.basename(p, ext);
      let target = path.join(dir, base + ' copy' + ext);
      let n = 2;
      while (fs.existsSync(target)) {
        target = path.join(dir, base + ' copy ' + n + ext);
        n++;
      }
      fs.copyFileSync(p, target);
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  // Export rendered: the note as a standalone HTML page, or that page printed
  // to PDF by a hidden window. `target` skips the dialog, and only the test
  // suite may pass one: the renderer never picks where a file lands on its own.
  ipcMain.handle('export:rendered', async (_ev, kind, html, name, target) => {
    if (kind !== 'html' && kind !== 'pdf') return { ok: false, error: 'unknown export kind' };
    try {
      let filePath = process.env.WIRED_E2E === '1' && target ? target : null;
      if (!filePath) {
        const result = await dialog.showSaveDialog(getWindow(), {
          title: kind === 'pdf' ? 'Export as PDF' : 'Export as HTML',
          defaultPath: name,
          filters: [kind === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'HTML', extensions: ['html', 'htm'] }]
        });
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };
        filePath = result.filePath;
      }
      await writeRendered(kind, html, filePath);
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  // Export: save dialog plus a copy of the file outside the vault.
  ipcMain.handle('fs:export', async (_ev, p) => {
    try {
      const result = await dialog.showSaveDialog(getWindow(), {
        title: 'Export file',
        defaultPath: path.basename(p),
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      fs.copyFileSync(p, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
}

module.exports = { register, writeRendered };
