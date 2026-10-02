// Entry point of the renderer: wires the modules, owns the global shortcuts and
// the document zoom, and boots the first pane with the saved config.
//
// It also re-exposes on `window` the handful of names the end to end suite
// drives the app through. That surface is deliberate and small: the tests speak
// to the app the way a user would, and this is the seam that lets them.

import { config, loadConfig, saveConfig, panes, groups, activePane, activeGroup, baseName, dirName } from './modules/state.js';
import { applyTheme, applyCustom, applySnippets, focusDimFor, relLuminance, contrastRatio } from './modules/theme.js';
import { initTitlebar, updateChrome, APP_NAME } from './modules/titlebar.js';
import {
  initPanes, openPath, openInPane, setDirty, setPaneDirty, closePane, closeActivePane,
  save, saveAs, newFile, openViaDialog, createGroup, moveTabToGroup, dropTabOnGroupHalf,
  restoreSession, sessionSnapshot, updateEmptyState, setActivePane,
  getSuppressExplorer, setSuppressExplorer, getLastNoteFolderReveal, setLastNoteFolderReveal
} from './modules/panes.js';
import {
  initTree, refreshSidebar, renderTree, renderRecents, applySidebarState, updateSortTooltip,
  toggleSidebar, setSidebarVisible, setSidebarWidth, setTreeSort, toggleTreeSearch,
  expandedDirs, getTreeRoot, getTreeFiles, getSelectedDir, setSelectedDir
} from './modules/tree.js';
import { hideCtxMenu, isCtxMenuOpen } from './modules/context-menu.js';
import { openPalette, closePalette, isPaletteOpen, PALETTE_ACTIONS, registerPaletteAction, fuzzyScore } from './modules/palette.js';
import { openSearch, closeSearch, isSearchOpen, getSearchHits, getSearchSel } from './modules/search.js';
import { handleFindKey } from './modules/find.js';
import { getDiskReloads } from './modules/disk-sync.js';
import { refreshFmPanel, refreshAllFmPanels, toggleFrontmatterPanel } from './modules/frontmatter.js';
import { newFromTemplate, getTemplateSel, setTemplateSel, closeTemplatePicker, isTemplatePickerOpen } from './modules/templates.js';
import { applyFocusMode, applyTypewriterMode, toggleFocusMode, toggleTypewriterMode, caretBlock, scrollContainerOf } from './modules/focus-typewriter.js';
import { initTerminal, toggleTerminal, setTerminalHeight, cdTerminalToNote, getXterm, termType, termTypeRaw, getTermBuffer } from './modules/terminal.js';
import { sendFileToClaude, sendSelectionToClaude } from './modules/ai-bridge.js';
import { initSettings, openSettings, closeSettings, isSettingsOpen, reflectFontSize } from './modules/settings.js';
import './modules/portrait.js';

const panesEl = document.getElementById('panes');

// --- document font zoom (Ctrl+=/-/0 and Ctrl+scroll over the text) ---
// It moves config.fontSize inside the 11 to 26 clamp of the settings panel and
// updates that field when the panel happens to be open.

function setFontZoom(v) {
  const size = Math.max(11, Math.min(26, Math.round(v)));
  config.fontSize = size;
  applyCustom();
  reflectFontSize(size);
  saveConfig();
}

function adjustFontZoom(delta) {
  setFontZoom((Number(config.fontSize) || 15) + delta);
}

panesEl.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    adjustFontZoom(e.deltaY < 0 ? 1 : -1);
  },
  { passive: false }
);

// Global shortcuts run in the CAPTURE phase: Vditor swallows keydown inside the
// editor, so without capture a Ctrl+S typed in the text would never arrive.
window.addEventListener(
  'keydown',
  (e) => {
    if (handleFindKey(e)) return;
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveAs();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newFile();
    }
    // Ctrl+W closes the tab in front of you, the way every tabbed editor does.
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      closeActivePane();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openViaDialog(false);
    }
    // Ctrl+P quick switcher, Ctrl+Shift+P command palette (Obsidian style).
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openPalette('files');
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openPalette('commands');
    }
    // Ctrl+Shift+F: full text search in the note's folder (content, not names).
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openSearch();
    }
    // Document font zoom: Ctrl+= (or Ctrl+Shift+=, which arrives as +), Ctrl+-
    // shrinks and Ctrl+0 goes back to the default.
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      adjustFontZoom(1);
    }
    if (e.ctrlKey && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      adjustFontZoom(-1);
    }
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      setFontZoom(15);
    }
    // F8 and F9: focus mode and typewriter mode, the same keys Typora uses (and
    // the only sensible ones that were still free here).
    if (!e.ctrlKey && !e.altKey && e.key === 'F8') {
      e.preventDefault();
      toggleFocusMode();
    }
    if (!e.ctrlKey && !e.altKey && e.key === 'F9') {
      e.preventDefault();
      toggleTypewriterMode();
    }
    // Ctrl+` opens and closes the terminal (on an ABNT keyboard it can arrive as
    // a quote).
    if (e.ctrlKey && (e.key === '`' || e.key === "'" || e.code === 'Backquote')) {
      e.preventDefault();
      toggleTerminal();
    }
    if (e.key === 'Escape') {
      if (isCtxMenuOpen()) hideCtxMenu();
      else if (isTemplatePickerOpen()) closeTemplatePicker(null);
      else if (isSearchOpen()) closeSearch();
      else if (isPaletteOpen()) closePalette();
      else if (isSettingsOpen()) closeSettings();
    }
  },
  true
);

// A file handed over at launch (argv, the shell association, a second instance)
// wins over the saved session: it is what the person asked for right now.
let bootFileSeen = false;
window.wired.onOpenFilePath((p) => {
  bootFileSeen = true;
  openPath(p, false);
});

// --- compat surface for the end to end suite ---
// Every name the checks in tests/e2e/checks touch. Read only values are plain
// getters; the four the tests ASSIGN to (selectedDir, templateSel,
// suppressExplorer, lastNoteFolderReveal) get a setter that writes back into the
// module that owns the state.

function expose(map) {
  for (const [name, value] of Object.entries(map)) {
    if (value && typeof value === 'object' && (value.get || value.set)) Object.defineProperty(window, name, value);
    else window[name] = value;
  }
}

expose({
  // live state of the active pane
  currentPath: { get: () => (activePane() ? activePane().path : null) },
  vditor: { get: () => (activePane() ? activePane().vditor : null) },
  dirty: { get: () => !!(activePane() && activePane().dirty) },
  xterm: { get: () => getXterm() },
  panes,
  groups,
  activeGroup,
  APP_NAME,
  config,
  PALETTE_ACTIONS,
  expandedDirs,
  treeRoot: { get: () => getTreeRoot() },
  treeFiles: { get: () => getTreeFiles() },
  searchHits: { get: () => getSearchHits() },
  searchSel: { get: () => getSearchSel() },
  diskReloads: { get: () => getDiskReloads() },
  selectedDir: { get: () => getSelectedDir(), set: (v) => setSelectedDir(v) },
  templateSel: { get: () => getTemplateSel(), set: (v) => setTemplateSel(v) },
  suppressExplorer: { get: () => getSuppressExplorer(), set: (v) => setSuppressExplorer(v) },
  lastNoteFolderReveal: { get: () => getLastNoteFolderReveal(), set: (v) => setLastNoteFolderReveal(v) },
  // paths and config
  baseName,
  dirName,
  saveConfig,
  applyTheme,
  applyCustom,
  applySnippets,
  focusDimFor,
  relLuminance,
  contrastRatio,
  // panes
  activePane,
  openPath,
  openInPane,
  setDirty,
  setPaneDirty,
  closePane,
  closeActivePane,
  setActivePane,
  createGroup,
  moveTabToGroup,
  dropTabOnGroupHalf,
  restoreSession,
  sessionSnapshot,
  updateEmptyState,
  save,
  saveAs,
  newFile,
  openViaDialog,
  updateChrome,
  // sidebar and tree
  refreshSidebar,
  renderTree,
  renderRecents,
  toggleSidebar,
  setSidebarVisible,
  setSidebarWidth,
  setTreeSort,
  toggleTreeSearch,
  hideCtxMenu,
  // palette, switcher and search
  openPalette,
  closePalette,
  registerPaletteAction,
  fuzzyScore,
  openSearch,
  closeSearch,
  // frontmatter, templates, modes
  refreshFmPanel,
  refreshAllFmPanels,
  toggleFrontmatterPanel,
  newFromTemplate,
  toggleFocusMode,
  toggleTypewriterMode,
  applyFocusMode,
  applyTypewriterMode,
  caretBlock,
  scrollContainerOf,
  // terminal and AI bridge
  toggleTerminal,
  setTerminalHeight,
  cdTerminalToNote,
  termType,
  termTypeRaw,
  getTermBuffer,
  sendFileToClaude,
  sendSelectionToClaude,
  // settings
  openSettings,
  closeSettings,
  setFontZoom,
  adjustFontZoom
});

// --- boot ---

initTitlebar();
initTree();
initTerminal();
initSettings();
initPanes();

(async function boot() {
  await loadConfig();
  await applyTheme(config.theme);
  await applySnippets();
  applySidebarState();
  renderRecents();
  updateSortTooltip();
  updateChrome();
  refreshAllFmPanels();
  applyFocusMode();
  applyTypewriterMode();
  updateEmptyState();
  // The launch file arrives on its own channel and can land a beat after the
  // config does, so the session is restored only once it is clear that nothing
  // was handed over.
  setTimeout(() => {
    if (!bootFileSeen && panes.length === 0) restoreSession();
  }, 350);
})();
