# MindBridge — Setup Guide

Step-by-step walkthrough for first-time setup. For features, commands, and configuration reference, see [README.md](README.md).

---

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

The other values have sensible defaults. See [README.md](README.md#configuration) for the full configuration reference.

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

---

## Step 5: Verify

Global slash commands can take **up to 1 hour** to propagate across Discord after the first registration. If you don't see the commands right away, wait and try again.

You should see in the logs:

```
[INFO] Registering 9 global slash commands...
[INFO] Slash commands registered successfully
[INFO] Bot logged in as MindBridge#1234
[INFO] MindBridge is running
```

Once available, type `/` in any channel on your server to see the commands.

---

## Quick Test

1. Run `/new-session topic:"Hello World"` in any channel
2. The bot creates a new channel and Claude introduces itself
3. Type a message in the new channel — Claude responds
4. Try `/ping` while Claude is working to see real-time progress
5. Run `/end-session session-id:"<id>"` to archive when done

For the full command reference and features, see [README.md](README.md#commands).
