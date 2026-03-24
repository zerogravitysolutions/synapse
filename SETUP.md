# MindBridge — Setup Guide

Instructions for setting up MindBridge. Works on **macOS**, **Linux**, and **Windows** (Docker mode on all three; Native mode on macOS/Linux, Windows users should use Docker or WSL).

If you are an AI agent, follow these steps in order. Run commands directly when possible. When user input is needed, ask the user clearly for the specific information required.

---

## Information needed from the user

Before starting, collect all three of these from the user:

1. **Discord Bot Token** — the user must create a Discord bot manually (see Step 1) and provide the token
2. **Discord Application ID** — also called Client ID, from the same Discord bot setup
3. **Claude OAuth Token** — the user must run `claude setup-token` on their machine and provide the `sk-ant-oat01-...` token

Also ask:

4. **Deployment mode** — present both options clearly:

```
Which deployment mode do you prefer?

A) Docker (recommended)
   + Isolated container — Claude only sees what you mount
   + Runs as a background service with auto-restart
   + No Node.js needed on host
   - Claude can only use Node.js and Docker CLI (no host tools like Java, Gradle, Python)
   - More complex setup (volumes, permissions)

B) Native
   + Claude has access to ALL your tools (Java, Gradle, Python, Docker, etc.)
   + Simpler setup — just npm install and run
   - Claude can access your entire filesystem
   - Needs a terminal session or pm2 for 24/7 running
```

5. **Workspace path** — (Native mode only) ask: "Which directory should Claude work in? Default: `~/Documents/workspace`"

---

## Step 1: Discord Bot (requires user action)

The user must do this in a browser. Give them these exact instructions:

```
1. Go to https://discord.com/developers/applications
2. Click "New Application", name it "MindBridge"
3. Go to Bot tab:
   - Click "Reset Token" → copy the token
   - Enable "Message Content Intent" under Privileged Gateway Intents
4. Go to OAuth2 tab:
   - Copy the "Application ID" (Client ID)
5. Go to OAuth2 > URL Generator:
   - Scopes: bot, applications.commands
   - Permissions: Manage Channels, Send Messages, Read Message History, Embed Links, Attach Files, Use Slash Commands
   - Open the generated URL in browser to invite the bot to your server
```

Ask the user to provide:
- The **Bot Token**
- The **Application ID (Client ID)**

---

## Step 2: Claude OAuth Token (requires user action)

Ask the user to run this command in their terminal:

```bash
claude setup-token
```

They should follow the prompts and provide the output token (`sk-ant-oat01-...`).

> **Important**: Do NOT accept tokens extracted from the macOS Keychain. Those are short-lived and will expire within hours. Only `claude setup-token` produces stable long-lived tokens.

---

## Step 3: Clone and Configure (agent can do this)

```bash
git clone https://github.com/zerogravitysolutions/synapse.git
cd synapse
cp .env.example .env
```

Write the `.env` file with the values collected from the user:

```
DISCORD_TOKEN=<bot token from Step 1>
DISCORD_CLIENT_ID=<application ID from Step 1>
CLAUDE_CODE_OAUTH_TOKEN=<token from Step 2>
```

For **Native mode only**, also set:

```
SESSION_FILE_PATH=./data/sessions.json
CLAUDE_WORK_DIR=<workspace path from user>
```

All other values have sensible defaults. See [README.md](README.md#configuration) for the full configuration reference.

---

## Step 4: Deploy (agent can do this)

### Docker Mode

```bash
docker compose up --build -d
```

First build takes a few minutes. Wait for it to complete, then verify:

```bash
docker compose logs --tail 10
```

### Native Mode

```bash
npm install
npm run build
mkdir -p ./data
npm start
```

For 24/7 background running:

```bash
npm install -g pm2
pm2 start dist/index.js --name mindbridge
pm2 save
pm2 startup
```

---

## Step 5: Verify (agent can do this)

Check the logs for these lines:

```
[INFO] Registering 9 global slash commands...
[INFO] Slash commands registered successfully
[INFO] Bot logged in as MindBridge#XXXX
[INFO] MindBridge is running
```

If all four lines appear, the bot is running. Tell the user:

```
MindBridge is running. Slash commands may take up to 1 hour to appear in Discord
(this is a Discord limitation for global commands). Once available, type / in any
channel to see them. Try /new-session topic:"Hello World" to create your first session.
```

---

## Troubleshooting

If the bot fails to start, check these in order:

1. **`Missing required environment variable`** → `.env` file is missing values. Verify all three required vars are set.
2. **Container exits immediately (Docker)** → Run `docker compose logs` to see the error.
3. **`MODULE_NOT_FOUND` (Native)** → Run `npm run build` first — TypeScript must be compiled.
4. **`Claude CLI error` in Discord** → OAuth token is expired or invalid. Ask the user to run `claude setup-token` again.
5. **Slash commands don't appear** → Wait up to 1 hour. This is normal for first registration.

---

## Summary of what the agent does vs what the user does

| Step | Who | Action |
|------|-----|--------|
| Create Discord bot | User | Manual browser setup, provides token + client ID |
| Generate Claude token | User | Runs `claude setup-token`, provides the token |
| Choose deployment mode | User | Docker or Native |
| Choose workspace path | User | Native mode only |
| Clone repo | Agent | `git clone` |
| Create .env | Agent | Write file with user-provided values |
| Build and deploy | Agent | `docker compose up --build -d` or `npm install && npm run build && npm start` |
| Verify | Agent | Check logs for success messages |
