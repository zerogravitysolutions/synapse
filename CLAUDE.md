# MindBridge

Discord bot bridging channels with Claude Code CLI sessions. TypeScript + discord.js v14. Single runtime dependency.

## Tool Conventions

- **Monitor tool:** Always pass `persistent: true`. Do not use `timeout_ms` unless the user explicitly asks for a bounded run. Stop persistent monitors with `TaskStop` when no longer needed.

## Setup & Deployment

Two deployment modes: **Docker** (isolated container) and **Native** (full host access).

- **[README.md](README.md)** — Features, commands, configuration, security, and architecture overview
- **[SETUP.md](SETUP.md)** — Agent-executable setup guide. Follow it step by step — run what you can, ask the user only for credentials and decisions

## Architecture

```
User message in Discord
  -> MessageHandler.handleMessage()        # forwards all channel messages to Claude
  -> MessageQueue.enqueue(sessionId, ...)  # per-session promise chain, prevents race conditions
  -> ClaudeCli.streamResumeSession()       # spawns: claude -p --dangerously-skip-permissions --resume <id> --model <model> --effort <effort> --output-format stream-json --verbose
  -> streaming events parsed line-by-line  # system/init, assistant (tool_use + text), system/task_started, result
  -> ActivityTracker updated in real-time  # goal, tool counts, todos, current action — read by /ping
  -> response split + file attachments     # splitMessage() for >1900 chars, collectAttachableFiles() for mentioned paths
  -> channel.send()                        # posted to Discord
```

## Key Files

- `src/index.ts` — Entry point, service wiring, graceful shutdown
- `src/services/claude-cli.ts` — CLI wrapper: startSession, resumeSession, forkSession, streamResumeSession (all accept per-session model/effort overrides)
- `src/services/message-handler.ts` — Message routing, attachment download/upload, typing indicator
- `src/services/activity-tracker.ts` — In-memory Map tracking goal, tool counts, current action per session
- `src/services/session-store.ts` — Session CRUD with atomic JSON persistence (tmp + rename)
- `src/services/message-queue.ts` — Per-session promise-chain queue
- `src/services/channel-manager.ts` — Discord category + channel creation/renaming
- `src/commands/` — 13 slash commands: new-session, list-sessions, connect-session, end-session, session-info, ping, pingme, stop, reset, aside, interrupt, set-model, set-effort
- `src/services/task-controller.ts` — Shared abort controller manager for /stop
- `src/utils/format-activity.ts` — Shared activity formatting for /ping and /pingme
- `src/utils/split-message.ts` — Code-block-aware message splitting for Discord's 2000 char limit

## Important Patterns

- **CLI stream-json format** is NOT raw API events. Key types: `system` (subtypes: `init`, `task_started`, `task_progress`), `assistant` (has `message.content` array with `text` and `tool_use` blocks), `user` (tool results), `result` (final output).
- **`task_started`/`task_progress`** only fire for sub-agents (e.g. `local_agent`), NOT for regular tool use. Regular tools show up as `tool_use` blocks in `assistant` events.
- **`--verbose` is required** with `--output-format stream-json` — without it the CLI errors.
- **File attachments**: Incoming Discord attachments are downloaded to `{os.tmpdir()}/mindbridge-uploads/{channelId}/`. Outgoing files are detected by scanning response text for absolute paths (Unix and Windows) that exist on disk (any extension, max 8 MB per file, 10 files, 25 MB total).
- **Atomic writes**: Session store writes to a temp file then renames — never corrupts on crash.
- **`spawn` with arg arrays**: No shell involved — inherently injection-safe. `stdio: ['ignore', 'pipe', 'pipe']` closes stdin to prevent headless blocking.

## Environment

- Config loaded from env vars in `src/config.ts`
- Required: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `CLAUDE_CODE_OAUTH_TOKEN`
- Defaults: `sessionFilePath` → `~/.mindbridge/sessions.json`, `claudeModel` → `opus`, `claudeEffort` → `max`. Override via env vars or per-session with `/set-model` and `/set-effort`.
- Timeout default: 86400000 ms (24 hours)

## Docker Volumes

- `mindbridge-claude` → `/home/mindbridge/.claude` (session history)
- `mindbridge-data` → `/data` (sessions.json)
- `~/Documents/workspace` → `/workspace` (project files, read/write)
- Docker socket → `/var/run/docker.sock` (so Claude can run Docker commands)

## Do Not

- Do not use `docker compose restart` after code changes — it doesn't rebuild. Use `docker compose build && docker compose up -d --force-recreate`.
- Do not extract Claude OAuth tokens from macOS Keychain — they auto-rotate. Use `claude setup-token`.
