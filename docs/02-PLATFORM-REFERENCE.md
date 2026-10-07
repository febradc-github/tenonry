# 02. Platform reference

Facts in section 1 were verified against official documentation on 2026-10-07. Section 2 lists items that must be re-verified in Phase 0 because they were confirmed only from secondary sources or could have changed. Section 3 is the Phase 0 procedure.

## 1. Verified facts

### 1.1 Claude Code subagents

Source: https://code.claude.com/docs/en/sub-agents.md

- Subagent files are Markdown with YAML frontmatter. Only `name` and `description` are required. Unknown fields are ignored silently, so spelling must be exact.
- Supported frontmatter fields: `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `omitClaudeMd`, `effort`, `isolation`, `color`, `initialPrompt`, `experimental`.
- `name` must not contain `:` and must not start with `-`. Names must be unique within a scope.
- `model` accepts `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`.
- **Per-invocation model**: when Claude invokes a subagent it can pass a `model` parameter. Resolution order: per-invocation parameter, then frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main conversation's model. Tenonry relies on this to route one specialist definition to different models.
- `effort` options: `low`, `medium`, `high`, `xhigh`, `max`; available levels depend on the model. There is no per-invocation effort parameter, so effort is fixed per agent in frontmatter.
- Scopes and priority: managed settings, `--agents` CLI flag, project `.claude/agents/`, user `~/.claude/agents/`, plugin `agents/` (lowest). `.claude/agents/` is scanned recursively; identity comes from `name` only.
- **Plugin subagents ignore `hooks`, `mcpServers`, and `permissionMode`.** Project subagents honor them. This is why Tenonry renders agents into the project.
- Project subagent frontmatter hooks run only after the user trusts the folder; until then the subagent runs without them and Claude Code logs an error to the debug log.
- Inline `mcpServers` in project agent files load only after folder trust. Inline definitions use the `.mcp.json` server schema keyed by server name. Example from the docs: `playwright` with `type: stdio`, `command: npx`, `args: ["-y", "@playwright/mcp@latest"]`. Tenonry 0.2.0 pins the version and passes `--headless`, `--isolated`, and `--output-dir` (decision D-061).
- `skills` preloads full skill content at subagent startup; skills with `disable-model-invocation: true` cannot be preloaded.
- Subagents never receive `AskUserQuestion`, `EnterPlanMode`, or `Workflow`. Background subagents keep a reduced built-in tool set that includes `Read`, `Grep`, `Glob`, `LSP`, `Bash`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `SendMessage`, and all MCP tools.
- Subagents can nest up to three layers by default. Default concurrent subagent limit: 20.
- Completed subagents can be resumed with `SendMessage` using the agent ID or name; a per-invocation `model` persists across resumes.
- Agent descriptions share a 15,000-token budget; Claude Code warns above it.
- A subagent's context at startup: its own system prompt (the file body), the delegation message, the CLAUDE.md hierarchy (unless `omitClaudeMd: true`), a git status snapshot, and preloaded skills. It does not see the main conversation.
- `PreToolUse` hooks receive JSON on stdin; the Bash command is at `tool_input.command`. Exit code 2 blocks the tool call and feeds stderr back to the agent.

### 1.2 Claude Code costs and caching

Sources: https://code.claude.com/docs/en/costs and https://code.claude.com/docs/en/prompt-caching

- Each model has its own prompt cache, and the cache is also keyed by effort level. Switching `/model` or `/effort` mid-conversation rereads the whole history uncached. Tenonry therefore never changes the main session's model mid-task; routing happens at subagent spawn time.
- Claude Code never invalidates the cache for a plugin's skills, commands, agents, hooks, monitors, or themes.
- The documented PreToolUse rewrite pattern returns `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": <full tool_input with modified command>}}`.
- MCP tool definitions are deferred by default; CLI tools are more context-efficient than MCP servers.
- Keep CLAUDE.md small; move specialized instructions to skills.

### 1.3 Claude Code plugins

Source: https://code.claude.com/docs/en/agent-sdk/plugins and the official plugin-structure skill

- The manifest lives at `.claude-plugin/plugin.json`. Component directories (`skills/`, `agents/`, `hooks/`, `commands/`) sit at the plugin root, never inside `.claude-plugin/`.
- Hooks load from `hooks/hooks.json` (or inline in the manifest). Hook commands reference plugin files with `${CLAUDE_PLUGIN_ROOT}`.
- Plugin skills are namespaced by plugin name, so skill `run` in plugin `tenonry` is `/tenonry:run`.
- `claude plugin validate <dir>` validates a plugin or an agents directory.

### 1.4 Jev on OpenRouter

Sources: https://openrouter.ai/docs/guides/community/jev, https://openrouter.ai/docs/guides/community/jev-tutorial, https://openrouter.ai/typesafe/jev-1.13

- Endpoint: `POST https://openrouter.ai/api/alpha/decisions` with `Authorization: Bearer <OPENROUTER_API_KEY>` and `Content-Type: application/json`. Chat-completions SDKs do not work with it.
- Request body: `{"model": "typesafe/jev-1.13", "state": <string|object|array>, "questions": {<id>: <question>}}`.
- Question shapes:
  - Noul: `{"type": "noul", "instructions": "...", "criteria": {"true": "...", "false": "..."}}`
  - Choice: `{"type": "choice", "instructions": "...", "criteria": {"<option>": "<description>", ...}}` (1 to 255 options)
  - Score: `{"type": "score", "instructions": "...", "criteria": ["<level 0>", "<level 1>", ...]}` (2 to 10 levels, lowest first)
- Response: `{"id", "model", "provider", "answers": {<id>: <answer>}, "usage": {"input_tokens", "output_tokens", "cost"}}` with answers:
  - Noul: `{"type": "noul", "noul": <0..1 probability of yes>}`
  - Choice: `{"type": "choice", "choice": "<option>", "confidence": <0..1>, "probabilities": {...}}`
  - Score: `{"type": "score", "score": <0..levels-1 probability-weighted position>, "confidence": <0..1>, "probabilities": {...}, "legend": {...}}`
- All questions in one request are answered in parallel and cannot see each other's answers.
- Context: 32,000 tokens for state plus questions. Price: $0.042 per million input tokens; output free. Text input only.
- Pin `typesafe/jev-1.13` so thresholds stay stable; `~typesafe/jev-latest` is a moving alias.
- The hosted Jev Router fails a request instead of falling back when Jev times out, which is why Tenonry implements its own fallback.

### 1.5 Design references used in rubrics

- Web Design Awards public rubric (https://www.webdesignawards.io/): User Experience and Strategy 15%, Visual Design and Branding 15%, Content and Storytelling 10%, Accessibility and Inclusivity 10%, Performance and Technical Implementation 20%, Responsiveness and Multi-device Support 10%, Innovation and Future Readiness 20%. Recent winners score roughly 7.5 to 8.5 out of 10.
- Anthropic harness design (https://www.anthropic.com/engineering/harness-design-long-running-apps): separate generator and evaluator; evaluator calibrated to be skeptical; Playwright-driven evaluation of the live page; criteria weighting design quality and originality; sprint contracts agreed before code.

## 2. Items to re-verify in Phase 0

| ID | Item | Expected | If different |
|---|---|---|---|
| V1 | Plugin `hooks/hooks.json` format | `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type": "command", "command": "...", "timeout": <seconds>}]}]}}`; `${CLAUDE_PLUGIN_ROOT}` expands in `command` | Use the documented format |
| V2 | PreToolUse `updatedInput` semantics | Full replacement of `tool_input`; requires `permissionDecision` | If merge semantics, still send the full object. If `ask` is required instead of `allow`, use `ask` and record it |
| V3 | UserPromptSubmit input and context | Input has `prompt`, `cwd`, `session_id`, `transcript_path`. JSON `hookSpecificOutput.additionalContext` adds context. (Tenonry never blocks prompts, so exit-code behavior is not relied on) | Adapt the router; if there is no model field, use the transcript fallback in docs/03 |
| V4 | SessionStart `additionalContext` | Supported via `hookSpecificOutput.additionalContext` | If not, print the context line to stdout |
| V5 | Skill frontmatter | `name`, `description`, `disable-model-invocation`, `argument-hint`, `allowed-tools`; `$ARGUMENTS` substitution; `${CLAUDE_SKILL_DIR}` substitution | Remove unsupported fields; rely on the SessionStart `TENONRY_PLUGIN_ROOT` fallback for paths |
| V6 | `.claude-plugin/marketplace.json` schema | `{"name", "owner": {"name"}, "plugins": [{"name", "source": "./", "description", "version"}]}` | Use the documented schema |
| V7 | Hook common input fields in subagents | `agent_id` and `agent_type` present for tool events inside subagents | Tenonry does not depend on them (the guard receives the agent name as an argument); record only |
| V8 | UserPromptSubmit `prompt` for plugin skills | Contains the raw text typed, including `/tenonry:run` | If the slash command is expanded before the hook, detect the run skill by its expanded marker line `TENONRY_RUN_SKILL` (present in the skill body) |
| V9 | `@playwright/mcp` tool names | `browser_navigate`, `browser_resize`, `browser_take_screenshot`, `browser_snapshot`, `browser_click`, `browser_press_key` | Update the design reviewer text to the actual names |
| V10 | Hook `timeout` unit | Seconds | Convert |

## 3. Phase 0 procedure

1. Fetch `https://code.claude.com/docs/llms.txt`. From it, fetch the pages for plugins (reference and components), hooks (reference), skills, and sub-agents.
2. Fetch `https://openrouter.ai/docs/llms.txt`, then the Decisions API reference page for `POST /api/alpha/decisions`.
3. For each of V1 to V10, write a `DECISIONS.md` entry: `Confirmed` with the source URL, or `Changed` with the new behavior and how the implementation adapts.
4. If a page cannot be fetched, treat the expected value in the table as correct, record `Unverified (fetch failed)`, and design the implementation to fail open around it.
5. Run `claude --version` and record it. If the CLI is missing, record that live checks will be skipped.
