# Windows launcher (portable)

Small helpers to run wired-md from source like a normal desktop app on
Windows, without opening a console window. Unlike a private shortcut, these
files hardcode no absolute path: they discover their own location, so they
work from wherever you cloned the repository.

## Files

- `wired-md.vbs` starts the app with no console window and accepts an optional
  `.md` path as its argument. It assumes it lives at
  `<repo>\scripts\windows\wired-md.vbs` and derives the repo root as the folder
  two levels up.
- `wired-md.cmd` is a thin wrapper that the Windows "Open with" dialog will
  accept (that dialog only lists `.exe`, `.bat`, and `.cmd`). It forwards the
  file to the `.vbs`. It uses `%~dp0`, so it always finds the `.vbs` beside it.

## Create a desktop shortcut

Right click `wired-md.vbs`, choose "Send to > Desktop (create shortcut)", or
create a shortcut whose target is:

```
wscript.exe "C:\path\to\repo\scripts\windows\wired-md.vbs"
```

## Make it the default app for .md files

Right click any `.md` file, choose "Open with > Choose another app", pick
"Browse for another app", and select `wired-md.cmd` from this folder. Check
"Always use this app" to make it the default. Windows will then open `.md`
files in wired-md on double click.

## Notes

- Requires `npm install` to have been run in the repo first, so
  `node_modules\electron` exists.
- These files carry no icon. Icons are a packaging concern and will come with a
  real installer (see the roadmap in the top level README).
