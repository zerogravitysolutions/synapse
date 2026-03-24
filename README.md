<p align="center">
  <img src="assets/cover.png" alt="MindBridge — Where Human Ingenuity Meets Machine Precision" width="100%" />
</p>

# MindBridge

A Discord bot that bridges Discord channels with Claude Code CLI sessions. Each conversation gets its own channel, messages are forwarded to Claude, and responses are posted back — enabling persistent, multi-session AI collaboration through Discord.

Runs 24/7 using a Claude Max subscription. No API key required. Works on macOS, Linux, and Windows.

---

## Installation Modes

| | **Native** | **Docker** |
|---|---|---|
| **Access** | Full host — all CLI tools, files, and environment | Isolated — only mounted dirs and container-installed tools |
| **Tools available** | Everything installed on your machine (Java, Gradle, Python, Docker, etc.) | Node.js and Docker CLI only (extend via Dockerfile) |
| **Filesystem** | Unrestricted — Claude sees your entire filesystem | Restricted — only `/workspace` (mounted) and `/tmp` |
| **Background running** | pm2 process manager | Docker restart policy (`always`) |
| **Setup complexity** | Simple — `npm install && npm start` | More involved — volumes, permissions, entrypoint |
| **Best for** | Development workflows needing full toolchain access | Running as a service with controlled access |

---

## Commands

### Session Management

| Command | Description |
|---|---|
| `/new-session topic:"..."` | Create a new Claude session and dedicated Discord channel |
| `/list-sessions` | List all active sessions with message count and last activity |
| `/connect-session session-id:"..."` | Resume an existing or archived session in a new channel |
| `/end-session session-id:"..."` | Archive a session, rename channel with `archived-` prefix |
| `/session-info` | Show session details for the current channel |
| `/reset` | Archive current session and start fresh in the same channel |

### During a Task

| Command | Description |
|---|---|
| `/ping` | Check what Claude is doing right now (instant, reads from memory) |
| `/pingme interval:"10m"` | Get automatic progress updates at a set interval (use `stop` to cancel) |
| `/stop` | Cancel the running task (kills the CLI process) |

Every message in a session channel is forwarded to Claude — just type normally.

---

## Features

| Feature | Description |
|---|---|
| **Multi-session** | Run multiple concurrent sessions, each in its own Discord channel |
| **Streaming activity** | Real-time tracking of Claude's progress via `--output-format stream-json` |
| **Smart `/ping`** | Shows goal, completed steps, tools used, current action, and elapsed time as a Discord embed |
| **Task cancellation** | `/stop` kills the running CLI process instantly, clears the queue |
| **File attachments** | Send screenshots/files to Claude (auto-downloaded for analysis) and receive generated images/files back |
| **Typing indicator** | Discord typing animation while Claude works (refreshed every 9s) |
| **Message splitting** | Long responses split on word boundaries, preserving code block fences |
| **Session persistence** | Atomic JSON file writes — survives crashes without corruption |
| **Graceful shutdown** | Drains in-flight tasks, flushes session store, then disconnects |
| **Discord formatting** | System prompt enforces Discord-compatible markdown (no tables, no `---`) |

---

## How It Works

1. User runs `/new-session topic:"Build a REST API"` in Discord
2. Bot creates a dedicated channel under a **CLAUDE SESSIONS** category
3. Claude introduces itself and confirms the topic
4. Every message in that channel is forwarded to Claude via the CLI
5. Claude's responses are posted back, with typing indicators while it thinks
6. Attachments (images, files) are downloaded and passed to Claude for analysis
7. If Claude creates images or files and mentions their path, they're attached to the Discord reply

Sessions persist across restarts. Multiple sessions run concurrently. Each session has its own message queue to prevent race conditions.

```
Discord User (text + attachments)
    |
    v
Discord Gateway (discord.js v14)
    |
    +-- Slash Commands (/ping, /stop, /reset, etc.)
    |       |
    |       +-- /ping, /pingme --> Activity Tracker (in-memory, instant)
    |       +-- /stop --> Task Controller (kills running CLI process)
    |       +-- /reset --> Queue (waits for in-flight task, then resets)
    |
    +-- Channel Messages --> Message Handler
                               |
                               +-- Download attachments
                               |
                               v
                  Per-Session Message Queue
                               |
                               v
                  Claude CLI (stream-json + verbose)
                  claude -p --dangerously-skip-permissions
                    --resume <id> --output-format stream-json
                               |
                  Streaming events: activity, tools, goal, skills
                               |
                               v
                  Response + detected file attachments
                               |
                               v
                  Discord Channel (split if >1900 chars)
```

---

## `/ping` — Real-Time Activity Status

While Claude is working on a long task, use `/ping` for an instant status check. It reads from an in-memory activity tracker — no CLI call, no queue wait.

The response is a Discord embed showing:
- **Goal** — extracted from Claude's first text or sub-agent task description
- **Done** — completed steps toward the goal
- **Tools** — compact summary of tools used (Read, Edit, Bash, Grep, etc.)
- **Skills** — any Claude Code skills invoked (e.g. `/mathstrict`)
- **What's left** — the current objective being worked toward
- **Now** — the specific action happening right now (e.g. `Editing services/auth.ts`)
- **Duration** — time since the task started

Use `/pingme interval:"5m"` to get these updates automatically on a timer.

---

## File & Image Support

### Sending files to Claude (Discord --> Bot)

Attach any file (screenshot, CSV, PDF, code file, etc.) to a message in a session channel. The bot:

1. Downloads each attachment to `/tmp/mindbridge-uploads/{channelId}/`
2. Appends the file paths to the message with a hint to use the Read tool
3. Claude reads the files and responds accordingly

Supports any file type up to 25 MB per attachment. You can include text alongside attachments or send attachments alone.

### Receiving files from Claude (Bot --> Discord)

When Claude's response mentions file paths (e.g. `/workspace/project/settings.gradle`), the bot checks if those files exist and attaches them to the Discord reply automatically.

- Up to 10 files, 8 MB per file, 25 MB total
- Files must exist on the container/host filesystem
- Attached to the last message chunk if the response is split

---

## Session Lifecycle

### Creating

`/new-session topic:"Build a REST API"`:
1. Bot calls Claude CLI first — if it fails, no channel is created (prevents orphans)
2. Channel created under the **CLAUDE SESSIONS** category (auto-created if missing)
3. Channel name: `{topic}-{session-id-prefix}` — e.g., `build-a-rest-api-a8e533`
4. Claude's introduction posted as a purple embed

### Active

- Messages queued and forwarded to Claude sequentially (one at a time per session)
- Typing indicator while Claude thinks
- Long responses auto-split, preserving code blocks
- Multiple sessions run concurrently — only same-session messages are serialized
- `/ping` checks status instantly without interrupting work
- `/stop` kills the running task if needed

### Archiving

`/end-session session-id:"a8e533"`:
1. Session marked `archived`, message queue cleared
2. Archival notice posted in the channel
3. Channel renamed with `archived-` prefix
4. Bot stops processing new messages in it

### Resuming

`/connect-session session-id:"a8e533"`:
1. New Discord channel created
2. Session marked active with the new channel ID
3. Claude summarizes the previous conversation
4. Works on both active and archived sessions

### Resetting

`/reset` in a session channel:
1. Current session archived
2. New Claude session started with the same topic
3. Same channel reused — no new channel created
4. No prior context carried over

---

## Quick Start

See **[SETUP.md](SETUP.md)** for a detailed step-by-step walkthrough including Discord bot creation, OAuth token setup, and deployment.

### Quick version

```bash
cp .env.example .env
# Fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, CLAUDE_CODE_OAUTH_TOKEN

# Docker
docker compose up --build -d

# Native
npm install && npm run build && npm start
```

Global slash commands take **up to 1 hour** to appear after first registration.

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | — | Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | — | Discord application/client ID |
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes | — | Claude OAuth token (`sk-ant-oat01-...`) |
| `SESSION_CATEGORY_NAME` | No | `CLAUDE SESSIONS` | Discord category for session channels |
| `SESSION_FILE_PATH` | No | `/data/sessions.json` | Session persistence path. **Native**: `./data/sessions.json` |
| `CLAUDE_CLI_PATH` | No | `claude` | Path to Claude CLI binary |
| `CLAUDE_CLI_TIMEOUT` | No | `86400000` (24h) | CLI timeout in milliseconds |
| `CLAUDE_WORK_DIR` | No | `/workspace` | Claude CLI working directory. **Native**: your workspace path |
| `LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |

---

## What Claude Can Access

### Native Mode

| Resource | Access |
|---|---|
| Filesystem | Unrestricted — all files your user can read/write |
| CLI tools | Everything installed (Java, Gradle, Python, Docker, etc.) |
| Network | All interfaces — local services, HTTP requests |
| Docker | If installed on host |

### Docker Mode

| Mount | Container Path | Access | Purpose |
|---|---|---|---|
| `~/Documents/workspace` | `/workspace` | Read/Write | Your project files |
| Docker socket | `/var/run/docker.sock` | Read/Write | Run Docker commands |
| Named volume | `/home/mindbridge/.claude` | Read/Write | Claude session history |
| Named volume | `/data` | Read/Write | Session store persistence |

In Docker mode, only Node.js and Docker CLI are available. To run Gradle tests, Claude uses Docker: `docker run -v /workspace/project:/app gradle:jdk21 gradle test`.

---

## Security

This setup prioritizes functionality over security. Understand the risks before deploying.

| Risk | Native | Docker | Mitigation |
|---|---|---|---|
| `--dangerously-skip-permissions` | Yes | Yes | Required for headless mode — no alternative for auto-approval |
| Full filesystem access | Yes | Mounted dirs only | Docker: mount specific dirs instead of entire workspace |
| Docker socket = root access | N/A | Yes | Remove `/var/run/docker.sock` mount if not needed |
| No Discord access control | Yes | Yes | Add user allowlist in message handler |
| No rate limiting | Yes | Yes | Implement per-user cooldowns |

**What IS safe**: No shell injection (`spawn` with arg arrays), atomic file writes (temp + rename), proper signal handling.

**Recommendation**: Suitable for **personal use on a private Discord server**. Do not deploy on servers with untrusted users without hardening.

---

## Operations

### Native Mode

```bash
npm start                    # foreground
pm2 start dist/index.js     # background
pm2 logs mindbridge          # logs
pm2 restart mindbridge       # restart
pm2 stop mindbridge          # stop
```

### Docker Mode

```bash
docker compose up --build -d  # build + start
docker compose logs -f        # logs
docker compose restart        # restart
docker compose down           # stop (data preserved)
docker compose down -v        # stop + delete all data
```

### Re-authenticate Claude

When the OAuth token expires:
1. Run `claude setup-token` on the host
2. Update `CLAUDE_CODE_OAUTH_TOKEN` in `.env`
3. Restart the bot

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Slash commands don't appear | Wait up to 1 hour for global command propagation |
| `Missing required environment variable` | Check `.env` has all required values |
| `Claude CLI error` in Discord | Re-authenticate Claude, update `.env`, restart |
| `Claude CLI timed out` | Retry, or increase `CLAUDE_CLI_TIMEOUT` |
| Bot ignores messages | Run `/session-info` — session may be archived. Use `/connect-session` |
| `No conversation found` | Session history lost (e.g., `docker compose down -v`). Start a new session |
| Markdown looks broken | Start a new session — old ones may predate the formatting system prompt |
| Container crash-loops | Check `docker compose logs` for the specific error |
| `MODULE_NOT_FOUND` (Native) | Run `npm run build` first |
| Gradle/Java not found (Docker) | Host tools unavailable in container. Use Docker-in-Docker or native mode |

---

## Project Structure

```
synapse/
+-- src/
|   +-- index.ts                  # Entry point, bootstrap, graceful shutdown
|   +-- bot.ts                    # Discord client setup, event wiring
|   +-- config.ts                 # Environment variable loading
|   +-- types.ts                  # Shared TypeScript interfaces
|   +-- commands/
|   |   +-- index.ts              # Global slash command registration
|   |   +-- new-session.ts        # /new-session
|   |   +-- list-sessions.ts      # /list-sessions
|   |   +-- connect-session.ts    # /connect-session
|   |   +-- end-session.ts        # /end-session
|   |   +-- session-info.ts       # /session-info
|   |   +-- ping.ts               # /ping
|   |   +-- pingme.ts             # /pingme
|   |   +-- stop.ts               # /stop
|   |   +-- reset.ts              # /reset
|   +-- services/
|   |   +-- claude-cli.ts         # Claude CLI wrapper (spawn, streaming, JSON parse)
|   |   +-- session-store.ts      # Session CRUD, atomic JSON persistence
|   |   +-- message-queue.ts      # Per-session promise-chain queue
|   |   +-- channel-manager.ts    # Discord category + channel management
|   |   +-- activity-tracker.ts   # Real-time task activity tracking
|   |   +-- task-controller.ts    # Shared abort controller for /stop
|   |   +-- message-handler.ts    # Message forwarding, typing, file attachments
|   +-- utils/
|       +-- logger.ts             # Timestamped structured logging
|       +-- sanitize.ts           # Discord channel name sanitization
|       +-- split-message.ts      # Code-block-aware message splitting
|       +-- format-activity.ts    # Shared activity formatting for /ping and /pingme
+-- entrypoint.sh                 # (Docker) Volume permissions, user drop
+-- Dockerfile                    # (Docker) Multi-stage build
+-- docker-compose.yml            # (Docker) Container orchestration
+-- .env.example                  # Environment template
+-- package.json
+-- tsconfig.json
+-- SETUP.md                      # Step-by-step setup walkthrough
```

---

## Tech Stack

- **Runtime**: Node.js 20, TypeScript (ES2022, Node16 modules)
- **Discord**: discord.js v14 — only runtime dependency
- **Claude**: `@anthropic-ai/claude-code` CLI via `child_process.spawn` with `stream-json` output
- **Container** (Docker): Multi-stage build, tini for signals, gosu for privilege dropping
- **Process manager** (Native): pm2 for 24/7 operation
- **Persistence**: Atomic JSON file writes (Docker volumes or local filesystem)

---

## Design Decisions

- **`spawn`, not `execFile`**: `stdio: ['ignore', 'pipe', 'pipe']` closes stdin — prevents CLI blocking in headless mode
- **Streaming over batch**: `--output-format stream-json --verbose` enables real-time activity tracking and tool-by-tool progress
- **In-memory activity tracker**: `/ping` reads from a lightweight Map — no CLI call, no queue wait, instant response
- **Task controller**: Shared `AbortController` manager lets `/stop` kill running CLI processes from a separate slash command
- **CLI-first, channel-second**: `/new-session` calls Claude before creating the channel — if the CLI fails, no orphan channel
- **Per-session queuing**: Messages to the same session serialized via promise chains; different sessions concurrent
- **Atomic persistence**: Write to `.tmp` then `fs.rename` — no partial writes on crash
- **Entrypoint as root** (Docker): Named volumes mount as root; entrypoint fixes ownership then drops to `mindbridge` via gosu
- **`--dangerously-skip-permissions`**: Required — headless mode has no UI for tool approval
- **Dual deployment**: Same codebase, same env var interface — only startup method differs

---

## Why Synapse?

- **Built for developers** — not a general-purpose assistant, but a focused bridge between Discord and Claude Code CLI for software engineering work
- **Full CLI tool access** — Read, Write, Edit, Bash, Grep, Glob — Claude works the same way it does in your terminal
- **No API key** — runs on a Claude Max subscription via the CLI, no token billing or usage tracking
- **Real-time visibility** — `/ping` and `/pingme` show what Claude is doing, what's done, and what's left while it works
- **Minimal footprint** — single dependency (`discord.js`), ~2700 lines of TypeScript, 3 env vars to configure
- **No database** — atomic JSON file persistence, nothing to install or maintain

---

## Future Ideas

### Multiple Claude Personalities via Webhooks

Discord webhooks can impersonate different identities — custom name and avatar per message. This would allow multiple "Claude personas" (e.g., "Senior Engineer", "Code Reviewer", "DevOps"), each with a unique avatar and system prompt.

Possible workflows:
- Ask the "Architect" to design a system, then the "Reviewer" to critique it
- Have "Backend" and "Frontend" personas working on different parts
- Assign different tool permissions per persona (read-only reviewer vs. full-access implementer)

---

## Contributing

MindBridge is open source and contributions are welcome! Whether it's a bug fix, new feature, documentation improvement, or idea — we'd love your help.

### How to Contribute

1. **Fork** the repository
2. **Create a branch** for your feature or fix: `git checkout -b feature/your-feature`
3. **Make your changes** — follow the existing code style (TypeScript, ES modules, minimal dependencies)
4. **Test locally** — run `npm run build` to verify TypeScript compiles, then test with a real Discord bot
5. **Submit a Pull Request** — describe what you changed and why

### Ideas for Contributions

- Voice message transcription (STT) and text-to-speech responses
- Scheduled tasks and proactive monitoring
- User access control and rate limiting
- Additional slash commands
- Support for more attachment types
- Session analytics and usage dashboards
- Webhook-based multi-persona support

### Guidelines

- Keep dependencies minimal — the project has a single runtime dependency (`discord.js`) and we'd like to keep it lean
- Follow the existing patterns: atomic writes, spawn with arg arrays (no shell), per-session queuing
- Add clear log messages for new features
- Update the README if your change adds configuration or commands

### Reporting Issues

Found a bug or have a suggestion? Open an issue on GitHub with:
- What you expected to happen
- What actually happened
- Steps to reproduce (if applicable)
- Logs or screenshots if relevant

---

## License

This project is licensed under the **MIT License** — you are free to use, modify, distribute, and build upon it for any purpose, personal or commercial.

See [LICENSE](LICENSE) for the full text.
