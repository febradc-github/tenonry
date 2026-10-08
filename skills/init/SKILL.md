---
name: init
description: Optional. Re-scan this project's stack and refresh Tenonry's agents. /tenonry:run already does this automatically.
disable-model-invocation: true
allowed-tools: Bash(node *), Read
---

TENONRY_INIT_SKILL

Re-scan and refresh Tenonry for the current project. This is optional: `/tenonry:run` sets up and refreshes the project automatically.

1. Find the plugin root. Use `${CLAUDE_SKILL_DIR}/../..`. If that text appears unexpanded, use the value after `TENONRY_PLUGIN_ROOT=` from the session context.
2. Run: `node "<plugin root>/scripts/init.mjs"` from the project directory. Init uses the current directory.
3. Read the JSON result and report to the user in a few short lines:
   - Detected packages and active specialists.
   - Agents written and removed.
   - Verification commands and preview command, or that none were found.
   - `jevKey: false`: tell the user to add `OPENROUTER_API_KEY=...` to the project's `.env` file. Tenonry still works without it, using fixed fallbacks instead of Jev routing.
   - `gitRepo: false`: tell the user `/tenonry:run` needs a git repository.
   - `empty: true`: tell the user the project has no code Tenonry recognizes yet, and that `/tenonry:run <what you want>` starts it from a starter stack that fits the request.
   - `agentsDirCreated: true`: tell the user to restart Claude Code once so it picks up the new `.claude/agents/` directory.
   - Always mention that project agents use hooks, which run only after the user accepts the workspace trust prompt for this folder.
4. If the result has `ok: false`, show the error and stop.
