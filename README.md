<p align="center">
  <img src="assets/cover.png" alt="MindBridge — Where Human Ingenuity Meets Machine Precision" width="100%" />
</p>

# MindBridge

A Discord bot that bridges Discord channels with Claude Code CLI sessions. Each conversation gets its own channel, messages are forwarded to Claude, and responses are posted back — enabling persistent, multi-session AI collaboration through Discord.

Runs 24/7 using a Claude Max subscription. No API key required.

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

### Slash Commands

| Command | Description |
|---|---|
| `/new-session topic:"..."` | Create a new Claude session and dedicated Discord channel |
| `/list-sessions` | List all active sessions with message count and last activity |
| `/connect-session session-id:"..."` | Resume an existing or archived session in a new channel |
| `/end-session session-id:"..."` | Archive a session, rename channel with `archived-` prefix |
| `/session-info` | Show session details for the current channel |

### In-Channel Commands

| Command | Description |
|---|---|
| *(any message)* | Forwarded to Claude — just type normally |
| `!status` | Show session ID, message count, and last active time |
| `!reset` | Archive current session and start fresh in the same channel |
| `!ping` | Check what Claude is doing without interrupting the current task |

---

## Features

| Feature | Description |
|---|---|
| **Multi-session** | Run multiple concurrent sessions, each in its own Discord channel |
| **Streaming activity** | Real-time tracking of Claude's progress via `--output-format stream-json` |
| **Smart `!ping`** | Shows goal, tools used so far, current action with purpose, and elapsed time as a natural paragraph |
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
    +-- Slash Commands --> Command Handlers
    |                          |
    +-- Channel Messages --> Message Handler
                               |
                               +-- !ping --> Activity Tracker (in-memory, instant)
                               |
                               +-- Normal --> Download attachments
                                                |
                                                v
                                   Per-Session Message Queue
                                                |
                                                v
                                   Claude CLI (stream-json + verbose)
                                   claude -p --dangerously-skip-permissions
                                     --resume <id> --output-format stream-json
                                                |
                                   Streaming events: activity, tools, goal
                                                |
                                                v
                                   Response + detected file attachments
                                                |
                                                v
                                   Discord Channel (split if >1900 chars)
```

---

## `!ping` — Real-Time Activity Status

While Claude is working on a long task, type `!ping` for an instant status check. It reads from an in-memory activity tracker — no CLI call, no queue wait.

Example response:

> I'm working on **refactoring the authentication middleware**. So far I've read 6 files, edited 2 files and ran 3 commands. Right now I'm searching code — looking for all usages of the old auth helper. Been at it for about **2m 34s**.

The response includes:
- **Goal** — extracted from Claude's first text or sub-agent task description
- **Progress** — human-readable summary of tool counts (files read, edited, commands ran, etc.)
- **Current action** — what Claude is doing right now, with the purpose/reason
- **Duration** — time since the task started

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
- `!ping` checks status instantly without interrupting work

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

`!reset` in a session channel:
1. Current session archived
2. New Claude session started with the same topic
3. Same channel reused — no new channel created
4. No prior context carried over

---

## Quick Start

### Prerequisites

- A Discord server you own/admin
- An active Claude Max subscription with `claude` CLI authenticated
- **Docker mode**: Docker and Docker Compose
- **Native mode**: Node.js 20+ and npm

### Step 1: Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. **New Application** > **Bot** tab > **Reset Token** (copy it)
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. **OAuth2 > URL Generator**: Scopes `bot` + `applications.commands`, Permissions: `Manage Channels`, `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`, `Use Slash Commands`
5. Invite the bot to your server using the generated URL

### Step 2: Get Claude OAuth Token

```bash
claude setup-token
```

Produces a stable `sk-ant-oat01-...` token valid for 1 year. **Do NOT extract from the macOS Keychain** — those short-lived tokens auto-rotate and will cause 401 errors.

### Step 3: Configure

```bash
cp .env.example .env
```

```
DISCORD_TOKEN=<your bot token>
DISCORD_CLIENT_ID=<your application ID>
CLAUDE_CODE_OAUTH_TOKEN=<your sk-ant-oat01-... token>
```

### Step 4: Run

#### Native Mode

```bash
npm install
npm run build
mkdir -p ./data
export SESSION_FILE_PATH=./data/sessions.json
export CLAUDE_WORK_DIR=~/Documents/workspace
npm start
```

For 24/7 running:

```bash
npm install -g pm2
pm2 start dist/index.js --name mindbridge
pm2 save && pm2 startup
```

#### Docker Mode

```bash
docker compose up --build -d
docker compose logs -f
```

#### Either Mode

Global slash commands take **up to 1 hour** to appear after first registration. Check logs for:

```
[INFO] Slash commands registered successfully
[INFO] Bot logged in as MindBridge#1234
[INFO] MindBridge is running
```

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
| `!ping` shows only "Processing your message..." | Ensure `--verbose` flag is set — streaming events need it |

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
|   +-- services/
|   |   +-- claude-cli.ts         # Claude CLI wrapper (spawn, streaming, JSON parse)
|   |   +-- session-store.ts      # Session CRUD, atomic JSON persistence
|   |   +-- message-queue.ts      # Per-session promise-chain queue
|   |   +-- channel-manager.ts    # Discord category + channel management
|   |   +-- activity-tracker.ts   # Real-time task activity tracking for !ping
|   |   +-- message-handler.ts    # Message routing, typing, file attachments
|   +-- utils/
|       +-- logger.ts             # Timestamped structured logging
|       +-- sanitize.ts           # Discord channel name sanitization
|       +-- split-message.ts      # Code-block-aware message splitting
+-- entrypoint.sh                 # (Docker) Volume permissions, user drop
+-- Dockerfile                    # (Docker) Multi-stage build
+-- docker-compose.yml            # (Docker) Container orchestration
+-- .env.example                  # Environment template
+-- package.json
+-- tsconfig.json
+-- SETUP.md                      # Detailed setup walkthrough
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
- **In-memory activity tracker**: `!ping` reads from a lightweight Map — no CLI call, no queue wait, instant response
- **CLI-first, channel-second**: `/new-session` calls Claude before creating the channel — if the CLI fails, no orphan channel
- **Per-session queuing**: Messages to the same session serialized via promise chains; different sessions concurrent
- **Atomic persistence**: Write to `.tmp` then `fs.rename` — no partial writes on crash
- **Entrypoint as root** (Docker): Named volumes mount as root; entrypoint fixes ownership then drops to `mindbridge` via gosu
- **`--dangerously-skip-permissions`**: Required — headless mode has no UI for tool approval
- **Dual deployment**: Same codebase, same env var interface — only startup method differs

---

## Future Ideas

### Multiple Claude Personalities via Webhooks

Discord webhooks can impersonate different identities — custom name and avatar per message. This would allow multiple "Claude personas" (e.g., "Senior Engineer", "Code Reviewer", "DevOps"), each with a unique avatar and system prompt.

Possible workflows:
- Ask the "Architect" to design a system, then the "Reviewer" to critique it
- Have "Backend" and "Frontend" personas working on different parts
- Assign different tool permissions per persona (read-only reviewer vs. full-access implementer)
