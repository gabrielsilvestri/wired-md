---
name: wired-md
description: Drive the wired-md markdown editor from the terminal with the experimental `wired` CLI. Use when the user has wired-md open (or wants it open) and asks to show, open, focus or create a .md note in the editor, or says things like "open that in the editor", "put this on my screen", "show me the file", "create a note from the skill template". Not for editing content: notes are edited by writing the file on disk.
---

# Driving wired-md from a terminal

wired-md is a desktop markdown editor for people who write markdown FOR AI:
CLAUDE.md files, skills, prompts, agent notes. It is the window the human is
reading while you work.

The `wired` CLI is EXPERIMENTAL. It exists so an AI agent working in a terminal
can put the right file in front of the human at the right moment.

## The one rule that shapes everything else

**To change a note, write the file on disk with your normal file tools.** The
editor watches every open note and picks the change up on its own: a pane with
no unsaved edits reloads in place, and a pane the human is editing shows a row
asking them to reload from disk or keep their version (nothing is overwritten
silently in either direction). The human can see exactly what you changed with
"what changed on disk" in the palette, so a focused edit reads better than a
rewrite of the whole file. The CLI has no
content API and will never get one: pushing text through a command line would be
a worse version of what you already do well.

The CLI is for four things only: open, focus, list, new.

## Commands

```
wired open <file>                                open a .md (starts the editor if it is not running)
wired focus <file>                               bring a file that is ALREADY open to the front
wired list                                       the files the editor has open
wired list --json                                the same, machine readable
wired new [--template <name>] [--title <title>]  create a note from a template and open it
```

`wired list --json` answers with an array of `{ path, dirty, active }`. `dirty`
means the human has unsaved edits in that pane: do not rewrite that file from
under them without saying so first.

`wired new` puts the file in the folder the editor currently has open, and falls
back to the folder you invoked the command from. `--template` names a file in
the editor's templates folder (`skill.md`, `claude-md.md` and whatever else the
user keeps there); `{{date}}`, `{{time}}`, `{{title}}` and `{{folder}}` are
filled in, and the interactive markers (`{{ask:...}}`, `{{cursor}}`) are left
alone because there is no human at the prompt.

## When to use each one

- You just wrote or rewrote a file the human should look at: `wired open <file>`.
- You are about to change a file and want to know whether it is on screen with
  unsaved edits: `wired list --json`.
- The human said "go back to the skill file" and it is already open in a pane:
  `wired focus <file>`.
- You are starting a new note from a template the user keeps: `wired new`.

Do not open a file the human did not ask about. Every `wired open` steals the
window's attention.

## Install

The Windows installer already puts `wired` on the user PATH (new terminals
only). From a source checkout:

```
npm install
npm link      # puts `wired` on PATH
```

Without `npm link`, `node bin/wired.js <command>` from the repository root does
the same thing.

## How it works, in case it breaks

There is no daemon, no server and no port. Launching the app again IS the
message: Electron's single instance lock hands the second process's argv to the
live window and that second process exits immediately. A command that has an
answer passes the path of a temp file, which the live instance writes and the
CLI polls for a few seconds.

Consequences worth knowing:

- `focus`, `list` and `new` fail fast when no editor is running in this profile.
  `open` starts one.
- The profile is `%APPDATA%\wired-md` unless `WIRED_USERDATA` points somewhere
  else. The CLI honors that variable, so an isolated test profile works.
- Each call costs one short lived Electron start up. It is fine for a handful of
  calls in a session; do not put it in a loop over a hundred files.

## What the CLI will not do

- No content editing (write the file instead).
- No staging, committing or branch switching (the editor has an embedded
  terminal for that, and you have a shell already).
- No custom URI scheme, no background process.
