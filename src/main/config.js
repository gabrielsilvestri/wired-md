// User data folders (themes, snippets, templates) and config.json.
//
// Everything the app persists lives in %APPDATA%\wired-md, never in the repo.
// The defaults are composed from per area objects so a new feature adds its own
// keys in one place instead of editing a single growing literal.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function userDir(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

const APPEARANCE_DEFAULTS = {
  theme: 'wired',
  accent: null,
  fontBody: '',
  fontCode: '',
  fontSize: 15,
  snippets: [],
  // Theme variable overrides from the settings panel, keyed by theme name:
  // { wired: { '--ink': '#c4cad1' } }. Per theme on purpose, since a color
  // measured against a dark page is wrong on a light one.
  themeOverrides: {}
};

const LAYOUT_DEFAULTS = {
  sidebarWidth: 240,
  sidebarVisible: true,
  terminalHeight: 260
};

const WORKSPACE_DEFAULTS = {
  recentFiles: [],
  treeSort: 'az',
  frontmatterPanel: true,
  focusMode: false,
  typewriterMode: false
};

// The AI CLI the bridge brings up in the terminal. It is a name, not a path:
// whatever is on PATH under this name is what gets typed. The bridge still
// never presses Enter, whichever CLI this is.
const AI_DEFAULTS = {
  aiCliCommand: 'claude'
};

const DEFAULT_CONFIG = Object.assign({}, APPEARANCE_DEFAULTS, LAYOUT_DEFAULTS, WORKSPACE_DEFAULTS, AI_DEFAULTS);

// Names that shipped before the project went English only. A config written by
// an older build still points at them, so they are mapped on read instead of
// leaving the user with a missing theme or a dead snippet.
const LEGACY_THEME_NAMES = { claro: 'light' };
const LEGACY_SNIPPET_NAMES = { 'exemplo-titulos-sublinhados.css': 'example-underlined-headings.css' };

function migrate(cfg) {
  if (cfg.theme && LEGACY_THEME_NAMES[cfg.theme]) cfg.theme = LEGACY_THEME_NAMES[cfg.theme];
  if (Array.isArray(cfg.snippets)) {
    cfg.snippets = cfg.snippets.map((s) => LEGACY_SNIPPET_NAMES[s] || s);
  }
  return cfg;
}

function ensureUserDirs() {
  const themesDir = userDir('themes');
  const snippetsDir = userDir('snippets');
  const templatesDir = userDir('templates');
  fs.mkdirSync(themesDir, { recursive: true });
  fs.mkdirSync(snippetsDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  // Copies what ships with the app (themes, snippets, templates) when it is not
  // in userData yet. An existing file is never overwritten: what the user edited
  // or deleted is their call.
  //
  // PACKAGED BUILD: the source folders live inside app.asar. `app.getAppPath()`
  // is the repo root in dev and `...\resources\app.asar` in an installed build,
  // and Electron's asar layer makes readdir and readFile work on both. The seed
  // is a readFileSync plus a writeFileSync rather than a copyFileSync, because
  // reading is the operation the asar layer is guaranteed to serve.
  const appRoot = app.getAppPath();
  const pairs = [
    [path.join(appRoot, 'themes'), themesDir, /\.css$/i],
    [path.join(appRoot, 'snippets'), snippetsDir, /\.css$/i],
    [path.join(appRoot, 'templates'), templatesDir, /\.(md|markdown)$/i]
  ];
  for (const [src, dest, ext] of pairs) {
    if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src)) {
      if (!ext.test(f)) continue;
      const target = path.join(dest, f);
      if (fs.existsSync(target)) continue;
      try {
        fs.writeFileSync(target, fs.readFileSync(path.join(src, f)));
      } catch (err) {
        // One unreadable seed is not worth refusing to boot over, but it is
        // worth saying out loud: a theme silently missing is a bug report.
        process.stderr.write('[wired-md] could not seed ' + f + ': ' + String(err && err.message ? err.message : err) + '\n');
      }
    }
  }
}

function readConfig() {
  try {
    const raw = fs.readFileSync(userDir('config.json'), 'utf8');
    return migrate(Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw)));
  } catch {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(userDir('config.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { userDir, DEFAULT_CONFIG, ensureUserDirs, readConfig, writeConfig };
