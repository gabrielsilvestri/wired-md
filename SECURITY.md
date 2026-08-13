# Security Policy

## Reporting a vulnerability

If you find a security issue, please report it privately by email to
**gabriel.cclnd@gmail.com**. Do not open a public issue for security problems.

Include what you found, how to reproduce it, and the impact you expect. You
will get an acknowledgement as soon as the maintainer sees the report.

## Trust model

wired-md is a local desktop application. It runs code on your machine and it
ships an embedded terminal that can invoke `claude` and other command line
tools in the folder of the file you have open.

Because of that, wired-md treats **any file you open as trusted**. Opening a
markdown file, browsing a folder in the sidebar, or running a template that
asks questions all happen with the same privileges as the rest of your user
account. Do not open files or folders from sources you do not trust, the same
way you would not run a script from a stranger.

The app has no server component and no telemetry. All state (config, themes,
snippets, templates, window state) lives locally under
`%APPDATA%\wired-md\`.
