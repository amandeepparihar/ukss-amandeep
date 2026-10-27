# Bug Workflow Setup Guide

Setup guide for the unified bug workflow commands in Claude Code.

## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and working
- Node.js (for the spec-workflow CLI)

## Step 1: Install the Superpowers Plugin

Inside any Claude Code session, run:

```
/install-plugin superpowers
```

This gives you systematic-debugging methodology, TDD, verification, and other workflows.

## Step 2: Install the Spec Workflow CLI

```bash
npm install -g @pimzino/claude-code-spec-workflow
```

This provides steering docs, bug templates, and the spec workflow infrastructure.

## Step 3: Set Up Steering Docs (One-Time Per Project)

Inside a Claude Code session in your project, run:

```
/spec-steering-setup
```

Follow the prompts. This creates `.claude/steering/` with your project's tech stack, structure, and conventions. The bug commands load these automatically for context.

## Step 4: Copy the Custom Command Files

Create the commands directory if it doesn't exist:

```bash
mkdir -p ~/.claude/commands
```

Copy these two files into `~/.claude/commands/`:

- **`bug.md`** — Single unified command (report, debug, fix, verify in one flow)
- **`bug-debug.md`** — Standalone debug+fix (pairs with existing bug-create/verify)

Both files are in this repository at `.claude/commands/bug.md` and `.claude/commands/bug-debug.md`.

```bash
# From the project root:
cp .claude/commands/bug.md ~/.claude/commands/bug.md
cp .claude/commands/bug-debug.md ~/.claude/commands/bug-debug.md
```

> **Global vs Project**: `~/.claude/commands/` makes them available in every project.
> To limit to one project, put them in `<project>/.claude/commands/` instead.

## Step 5: Verify Installation

Start a new Claude Code session and check that these commands show up:

```
/bug
/bug-debug
```

You should also still have the original commands:

```
/bug-create
/bug-analyze
/bug-fix
/bug-verify
/bug-status
```

## How to Use

### Single-Session (Do Everything at Once)

```
/bug login-timeout "Users getting logged out after 5 minutes"
```

Walks you through all 4 phases: Report → Investigate root cause → Fix → Verify. User approval required between each phase.

### Multi-Session (Create Now, Fix Later)

```
/bug-create login-timeout "Users getting logged out after 5 minutes"
```

Come back later in a new session:

```
/bug-debug login-timeout
```

When the fix is done:

```
/bug-verify login-timeout
```

### Parallel Bugs (Create Multiple, Debug in Parallel)

```
/bug-create bug-a "Description A"
/bug-create bug-b "Description B"
/bug-create bug-c "Description C"
```

Then dispatch parallel agents to analyze/fix each one independently.

## Command Reference

| Command | Purpose |
|---------|---------|
| `/bug` | **All-in-one**: Report → Root cause → Fix → Verify |
| `/bug-create` | Log a bug — creates GitHub issue + `report.md` |
| `/bug-debug` | **Find root cause + fix** — systematic debugging methodology |
| `/bug-verify` | Confirm the fix works, close GitHub issue with RCA |
| `/bug-analyze` | *(Original)* Investigation only, no fix |
| `/bug-fix` | *(Original)* Fix only, no investigation |
| `/bug-status` | Check status of a bug |

## Which Command Should I Use?

| Scenario | Use |
|----------|-----|
| Quick single bug, one session | `/bug` |
| Log bugs now, fix later | `/bug-create` then `/bug-debug` then `/bug-verify` |
| Multiple bugs in parallel | `/bug-create` x N, then dispatch parallel agents |
| Already fixed, just need to verify | `/bug-verify` |
| Prefer the old 4-step workflow | `/bug-create` → `/bug-analyze` → `/bug-fix` → `/bug-verify` |

## What Gets Created Per Bug

```
.claude/bugs/{bug-name}/
├── report.md        ← Bug description, steps to reproduce
├── analysis.md      ← Root cause, evidence, fix plan
└── verification.md  ← Test results, completion checklist
```

A GitHub issue is also created with the bug ID and description.

## Key Methodology: Systematic Debugging

The `/bug` and `/bug-debug` commands enforce a strict debugging discipline:

1. **No fixes without root cause investigation first** — guessing wastes time
2. **Reproduce consistently** before investigating
3. **Trace data flow** backward through the call chain to find the source
4. **Form a hypothesis** and test minimally — one change at a time
5. **If 3+ fixes fail**, stop and question the architecture — don't keep patching
6. **Add defense-in-depth** validation at every layer data passes through

## RCA (Root Cause Analysis) on GitHub Issues

When closing a bug, an RCA comment is added to the GitHub issue:

```markdown
[RCA]

**Root Cause:** Why the bug occurred (the actual programming mistake)
**Prevention Rule:** Concrete rule to prevent this in future

### Pattern to Avoid
// BAD: Example of buggy pattern

### Correct Pattern
// GOOD: Example of correct pattern
```

This builds a searchable knowledge base: `[RCA] in:comments is:closed`
