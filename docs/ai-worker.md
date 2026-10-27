# Local Worker Delegation

## Problem

The main Claude Code session (your normal subscription session) is good at
planning, reviewing, and making judgment calls, but every line it writes
costs subscription usage. A lot of implementation work — boilerplate,
mechanical refactors, test scaffolding — doesn't need that judgment. This
setup lets you delegate that work to a cheaper/local/API-backed model (via
LiteLLM, Ollama, or any Anthropic-API-compatible endpoint) that runs in its
own **git worktree**, so it can never touch your working tree directly. It
produces a patch file. You (or main Claude Code) review the patch and decide
whether to apply it.

Nothing here auto-applies, auto-commits, or auto-pushes anything.

## Roles

**Main Claude Code session** (your normal auth):
- Talks to you, plans the work, decides what to delegate.
- After the worker finishes, reviews the generated patch.
- Applies the patch (or asks you to) and does any judgment-call cleanup.
- Owns anything security-sensitive — see "Keep with main Claude" below.

**Worker session** (LiteLLM/local/API model):
- Runs non-interactively inside an isolated worktree on its own branch.
- Only ever produces a diff — it never commits, pushes, or touches the main
  working tree.

## Configuring a local/LiteLLM/Ollama model

The worker is just `claude` invoked with a different set of Anthropic-API
environment variables pointed at your LiteLLM (or other Anthropic-compatible)
gateway. Copy the template and fill in real values:

```bash
cp .claude/local-worker.env.example .claude/local-worker.env
```

`.claude/local-worker.env` (repo-local, gitignored):

```
ANTHROPIC_BASE_URL=https://litellm.example.com
ANTHROPIC_AUTH_TOKEN=sk-...
ANTHROPIC_MODEL=glm-5-turbo
ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-4.7-flashx
ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5-turbo
ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.2
API_TIMEOUT_MS=3000000
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
CLAUDE_CODE_AUTO_COMPACT_WINDOW=180000
MAX_MCP_OUTPUT_TOKENS=20000
```

If you'd rather share one config across every repo on your machine instead
of per-repo, put the same file at `~/.claude/local-worker.env` instead.

**Precedence** (first match wins, so you can override per-shell without
editing files): current shell environment → `.claude/local-worker.env` →
`~/.claude/local-worker.env`.

Never commit `.claude/local-worker.env` — it holds your API token. It's
already in `.gitignore`.

## Running the worker manually

```bash
.claude/scripts/local-worker.sh "add unit tests for the invoice parser"
```

This will:
1. Create a new worktree next to the repo (`../<repo>-worktrees/<run-id>`).
2. Create a branch `worker/<safe-task-name>-<timestamp>`.
3. Write the task into `.claude-worker-task.md` inside that worktree.
4. Load the worker env vars (see precedence above).
5. Run `claude -p` non-interactively inside the worktree with a restricted
   tool list (no `sudo`, `rm -rf`, `git push`, `npm publish`, etc.). If the
   invocation itself fails (e.g. the worker model/gateway is down), it
   retries up to `WORKER_MAX_ATTEMPTS` times (default `10`), waiting
   `WORKER_RETRY_WAIT_SECONDS` between attempts (default `3`), before giving
   up. Override either via env var if your endpoint needs longer backoff.
6. Convert whatever it changed into a patch, without committing anything.

Output: worktree path, branch name, patch path, summary, status, and the
exact review/apply/cleanup commands to run next. Status is one of
`changes-generated`, `changes-generated-with-errors`, `no-changes`,
`failed` (every attempt errored and produced no diff — check the
`.worker-output.log`, and consider just writing the code directly instead
of waiting on the worker), or `not-run` (no `--print` support).

If your `claude` build has no `--print` mode, the script stops and prints
the exact `cd`/`claude` commands to run the worker interactively yourself.

## How Claude Code (the main session) calls the worker

Ask the main session to delegate, e.g. "delegate this to the local worker:
add pagination to the orders list." Main Claude Code should then run:

```bash
.claude/scripts/local-worker.sh "<task description>"
```
(or `/local-worker <task description>` if slash commands are enabled — see
`.claude/commands/local-worker.md`), then read the resulting summary file
and tell you whether the patch looks ready for review.

## Reviewing and applying a patch

```bash
# list recent worker patches
.claude/scripts/review-worker-patch.sh

# check + show stats/touched files for one patch (dry run, default)
.claude/scripts/review-worker-patch.sh .claude/worker-runs/<run-id>.patch

# apply it to your working tree (still not committed)
.claude/scripts/review-worker-patch.sh .claude/worker-runs/<run-id>.patch --apply
```

The script never applies a patch unless you pass `--apply`. After applying,
review with `git diff` / `git status` and commit yourself when satisfied.

## Direct-edit guard hook

`.claude/hooks/guard-direct-edits.sh` is wired into `.claude/settings.json`
as a `PreToolUse` hook on `Edit`/`Write`. It's a nudge, not a wall:

- Docs/config files (`.md`, `.json`, `.yaml`, `.env`, etc.) are always allowed.
- Edits/writes under ~40 lines are always allowed.
- Anything bigger triggers a warning telling Claude to consider
  `.claude/scripts/local-worker.sh` instead — but still proceeds
  (`GUARD_DIRECT_EDITS_MODE=warn`, the default).

To make it actually block large direct edits instead of warning, set
`GUARD_DIRECT_EDITS_MODE=block` (e.g. in `.claude/local-worker.env` or your
shell). Set `GUARD_DIRECT_EDITS_MODE=off` to disable it entirely. Adjust the
line threshold with `GUARD_DIRECT_EDITS_LINE_THRESHOLD` (default `40`).

## Cleaning up old worktrees

```bash
# list worker worktrees
.claude/scripts/cleanup-worker.sh

# remove one (asks for confirmation; deletes the branch only if merged)
.claude/scripts/cleanup-worker.sh ../<repo>-worktrees/<run-id>

# also force-delete an unmerged branch
.claude/scripts/cleanup-worker.sh ../<repo>-worktrees/<run-id> --force
```

## Safety rules and limitations

- The worker never commits, pushes, or applies its own patch.
- The worker's tool list denies `sudo`, `rm -rf`, `curl|bash`, `wget|bash`,
  `chmod 777`, `git push`, and `npm publish` — but this is a guardrail, not a
  sandbox. Treat the worker like any other API call: don't feed it secrets,
  and don't run it against a dirty working tree you care about (it's
  isolated in its own worktree, but be aware of what you paste into a task).
- Patches, summaries, logs, and status files are gitignored — they can
  contain task content and are not meant to be committed.
- The main Claude Code session is responsible for catching anything a
  cheaper/local model got wrong before it's applied.

### Good tasks for the worker

- Writing or filling out tests
- Boilerplate / repetitive code changes
- Simple, mechanical refactors
- Low-risk feature implementation with a clear spec

### Keep with main Claude / a human reviewer

- Authentication and authorization
- Payments
- Production database migrations
- Security-sensitive logic
- Large architecture changes

Direct edits by main Claude Code (no delegation needed) are fine for very
small fixes, documentation, formatting, and corrections found during patch
review.
