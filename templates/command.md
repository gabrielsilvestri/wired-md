---
description: {{ask:what the command does, as the / menu should show it}}
argument-hint: "[what to pass after the command]"
allowed-tools: Read, Grep, Glob
---

{{cursor}}

Do (the task) for $ARGUMENTS.

## Steps

1. read what the arguments point at before changing anything
2. do the work
3. report what changed, with file paths

Save this file in `.claude/commands/` of a project (or `~/.claude/commands/` for every project). The file name is the command name: `review.md` becomes `/review`.

Defined on {{date}}, at {{time}}.
