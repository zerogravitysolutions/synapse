# MindBridge Setup & Usage Guide

## Prerequisites

- A Discord account with a server you own/admin
- An active Claude Max subscription with `claude` CLI authenticated on your host machine
- **For Docker mode**: Docker and Docker Compose installed
- **For Native mode**: Node.js 20+ and npm installed

---

## Step 1: Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **New Application**, name it `MindBridge`
3. Go to **Bot** tab:
   - Click **Reset Token**, copy the token (you'll need it for `.env`)
   - Under **Privileged Gateway Intents**, enable **Message Content Intent**
4. Go to **OAuth2** tab:
   - Copy the **Application ID** (also called Client ID) — you'll need this for `.env`
5. Go to **OAuth2 > URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Manage Channels`, `Send Messages`, `Read Message History`, `Embed Links`, `Attach Files`, `Use Slash Commands`
   - Copy the generated URL, open it in your browser, and invite the bot to your server

---

## Step 2: Get Claude OAuth Token

Generate a long-lived token (valid for 1 year):

```bash
claude setup-token
```

Follow the prompts. It will output a `sk-ant-oat01-...` token. Copy it — you'll need it for `.env`.

> **Important**: Do NOT extract tokens from the macOS Keychain. Those are short-lived OAuth access tokens that the CLI auto-rotates every few hours. They will expire and cause 401 authentication errors. Always use `claude setup-token` for a stable, long-lived token.

---

## Step 3: Configure Environment

```bash
cd /path/to/synapse
cp .env.example .env
```

Edit `.env` and fill in your real values:

```
DISCORD_TOKEN=<paste your bot token here>
DISCORD_CLIENT_ID=<paste your application/client ID here>
CLAUDE_CODE_OAUTH_TOKEN=<paste your Claude OAuth token here>
```

**For native mode only**, also update these defaults:

```
SESSION_FILE_PATH=./data/sessions.json
CLAUDE_WORK_DIR=/Users/yourname/Documents/workspace
```

The other values have sensible defaults. Leave them unless you know what you're changing.

---

## Step 4: Choose Your Deployment Mode

### Option A: Native Mode (Full Host Access)

Claude runs directly on your machine with access to all your tools — Java, Gradle, Docker, Python, etc.

```bash
npm install
npm run build
mkdir -p ./data
npm start
```

**For 24/7 running**, use pm2:

```bash
npm install -g pm2
pm2 start dist/index.js --name mindbridge
pm2 save
pm2 startup    # auto-start on boot
```

**pm2 commands:**

```bash
pm2 logs mindbridge      # tail logs
pm2 restart mindbridge   # restart
pm2 stop mindbridge      # stop
pm2 delete mindbridge    # remove from pm2
```

### Option B: Docker Mode (Isolated Container)

Claude runs inside a container. Only mounted directories and tools installed in the image are accessible.

```bash
docker compose up --build
```

First build takes a few minutes (installs Claude Code CLI and Docker CLI in the container). Subsequent builds are cached.

**Background mode:**

```bash
docker compose up --build -d
docker compose logs -f    # tail logs
```

**Docker commands:**

```bash
docker compose restart        # restart
docker compose down           # stop (data preserved in volumes)
docker compose down -v        # stop and delete all data
```

---

## Step 5: Wait for Slash Commands

Global slash commands can take **up to 1 hour** to propagate across Discord after the first registration. If you don't see the commands right away, wait and try again.

Once available, you'll see them by typing `/` in any channel on your server.

You should see in the logs:

```
[INFO] Registering 5 global slash commands...
[INFO] Slash commands registered successfully
[INFO] Bot logged in as MindBridge#1234
[INFO] MindBridge is running
```

---

## Usage

### Slash Commands

- `/new-session topic:"my topic"` — Creates a new Claude session + Discord channel
- `/list-sessions` — Shows all active sessions with message count and last activity
- `/connect-session session-id:"abc123"` — Reconnects to an existing (or archived) session
- `/end-session session-id:"abc123"` — Archives a session, renames channel with `archived-` prefix
- `/session-info` — Shows details about the session in the current channel

### In-Channel Commands

Once inside a session channel, just type normally — every message is forwarded to Claude.

- `!status` — Shows session ID, message count, and last active time
- `!reset` — Archives the current session and starts a fresh one in the same channel
- `!ping` — Instant progress check: shows goal, tools used, current action, and duration (reads from in-memory tracker, no CLI call)

### Walkthrough

1. **Start a session**: Go to any channel and run `/new-session topic:"Build a REST API"`. The bot creates a new channel under the **CLAUDE SESSIONS** category and posts Claude's first response.

2. **Chat with Claude**: Navigate to the new channel. Type any message — the bot shows a typing indicator while Claude thinks, then posts the response. Long responses are automatically split.

3. **Send files**: Attach screenshots, CSVs, PDFs, or any file to your message. The bot downloads them and passes the paths to Claude for analysis. Claude can also send files back — any file path mentioned in its response is auto-attached to the Discord reply.

4. **Check on a long task**: Type `!ping` for an instant progress report — goal, tools used, current action, and elapsed time.

5. **Check status**: Type `!status` to see message count and session ID.

6. **List all sessions**: Run `/list-sessions` anywhere to see all active sessions.

7. **Archive a session**: Run `/end-session session-id:"<first 8 chars>"`. The channel gets renamed with an `archived-` prefix. You can use partial IDs.

8. **Resume a session**: Run `/connect-session session-id:"<first 8 chars>"`. A new channel is created and Claude summarizes the previous conversation. This works on archived sessions too.

9. **Fresh start**: Inside a session channel, type `!reset`. The old session is archived, a new one starts in the same channel.

---

## What Claude Can Access

### Native Mode

- **Everything on your machine** — all files, all installed tools (Java, Gradle, Docker, Python, etc.)
- **Your full filesystem** — not restricted to any directory
- **All network interfaces** — local services, HTTP requests, etc.

### Docker Mode

- **Your workspace** (`~/Documents/workspace` → `/workspace`): Claude can read and modify files in all your projects
- **Docker socket** (`/var/run/docker.sock`): Claude can run Docker commands (inspect containers, check logs, etc.)
- **Claude session history** (Docker volume): Conversation context persists across messages within a session

Claude runs with `--dangerously-skip-permissions` since there's no interactive UI to approve tool calls in headless mode.

**Note**: In Docker mode, Claude does not have access to host-installed tools like Java or Gradle. To run Gradle tests, Claude would use Docker: `docker run -v /workspace/project:/app gradle:jdk21 gradle test`. In native mode, Claude can run `./gradlew test` directly.

---

## Operations

### Re-authenticate Claude (Both Modes)

When the Claude OAuth token expires:

1. Re-authenticate on the host machine: `claude` (follow the login flow)
2. Extract the new token (see Step 2) and update `CLAUDE_CODE_OAUTH_TOKEN` in `.env`
3. Restart the bot (`pm2 restart mindbridge` or `docker compose restart`)

### Native Mode

Session data is stored at `SESSION_FILE_PATH` (default `./data/sessions.json`).
Claude session history is stored in `~/.claude/`.

### Docker Mode

Session data and Claude history are preserved in named volumes (`mindbridge-data`, `mindbridge-claude`).

**Full reset** (destroys all data):

```bash
docker compose down -v
```

---

## Troubleshooting

- **Bot starts but slash commands don't appear**: Global commands take up to 1 hour to propagate. Wait, or check logs for registration errors.
- **`Missing required environment variable`**: `.env` file missing or incomplete. Copy `.env.example` to `.env` and fill in values.
- **`Claude CLI error` in Discord**: Auth token expired or CLI issue. Re-authenticate `claude` on host, extract new token, update `.env`, restart.
- **`Claude CLI timed out`**: Claude took too long to respond. Try again, or increase `CLAUDE_CLI_TIMEOUT` in `.env`.
- **Bot ignores messages in session channel**: Session may be archived. Run `/session-info` to check. Use `/connect-session` to resume.
- **Container crash-loops** (Docker): Usually missing credentials or invalid token. Check `docker compose logs`.
- **`No conversation found with session ID`**: Session history was lost (e.g., after `docker compose down -v`). Start a new session.
- **Markdown looks broken in Discord**: Start a new session — old ones may predate the Discord formatting system prompt.
- **`MODULE_NOT_FOUND`** (Native): Run `npm run build` first — TypeScript must be compiled.
- **Gradle/Java not found** (Docker): Host tools aren't available in the container. Switch to native mode or use `docker run gradle:jdk21 ...`.

---

## Configuration Reference

- `DISCORD_TOKEN` (required) — Discord bot token
- `DISCORD_CLIENT_ID` (required) — Discord application/client ID
- `CLAUDE_CODE_OAUTH_TOKEN` (required) — Claude OAuth token (`sk-ant-oat01-...`)
- `SESSION_CATEGORY_NAME` (default: `CLAUDE SESSIONS`) — Name of the Discord category for session channels
- `SESSION_FILE_PATH` (default: `/data/sessions.json`) — Path to the session persistence file. **Native**: use `./data/sessions.json`
- `CLAUDE_CLI_PATH` (default: `claude`) — Path to the Claude CLI binary
- `CLAUDE_CLI_TIMEOUT` (default: `86400000` / 24 hours) — CLI timeout in milliseconds
- `CLAUDE_WORK_DIR` (default: `/workspace`) — Working directory for Claude CLI. **Native**: use your actual workspace path
- `LOG_LEVEL` (default: `info`) — Log level: `debug`, `info`, `warn`, `error`

---

## Architecture Overview

```
Discord User
    │
    ▼
Discord Gateway (discord.js v14)
    │
    ├─ Slash Commands ──▶ Command Handlers
    │                         │
    └─ Channel Messages ─▶ Message Handler
                              │
                              ├─ !ping ──▶ Activity Tracker (in-memory, instant)
                              │
                              └─ Normal ──▶ Download attachments (if any)
                                                │
                                                ▼
                                      Per-Session Message Queue
                                                │
                                                ▼
                                      Claude CLI (child_process.spawn)
                                      claude -p --dangerously-skip-permissions
                                        --output-format stream-json --verbose
                                                │
                                      Streaming events → Activity Tracker
                                                │
                                                ▼
                                      Response + auto-attached files
                                                │
                                                ▼
                                      Discord Channel (split if >1900 chars)

Session Store (sessions.json)  ◀── atomic writes (tmp + rename)
    │
    ▼
Local filesystem or Docker Volume
```

Key design choices:
- **No shell involved**: `spawn` with argument arrays — inherently injection-safe
- **stdin explicitly closed**: `stdio: ['ignore', 'pipe', 'pipe']` prevents CLI stdin blocking
- **Per-session queuing**: Messages to the same session are serialized; different sessions run concurrently
- **Instant !ping**: Reads from in-memory activity tracker — no CLI call, no queue wait
- **Atomic persistence**: Write to temp file, then `fs.rename` — no partial writes
- **Signal handling**: `init: true` in Docker (tini as PID 1) or pm2 in native mode
- **Credential handling**: OAuth token passed via `CLAUDE_CODE_OAUTH_TOKEN` env var — no file mounts needed
- **Privilege separation** (Docker): Entrypoint runs as root for setup, drops to `mindbridge` user via `gosu`
- **Discord formatting**: System prompt instructs Claude to use only Discord-compatible markdown
- **Dual deployment**: Same codebase runs natively or in Docker — only env vars and startup method differ
