---
name: example-skill
description: example skill that shows off the wired-md properties panel
tools:
  - Read
  - Write
  - Bash
model: sonnet
# comment preserved on round trip
published: false
meta:
  author: biel
  version: 2
---
# example skill

This file exists to demonstrate (and test) the properties panel: the frontmatter
block above becomes editable rows at the top of the pane.

## when to use

When the frontmatter carries meaning: SKILL.md, subagents, a CLAUDE.md with
metadata. A typo in `name` or `description` breaks the agent silently.
