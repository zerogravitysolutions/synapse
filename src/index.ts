import { loadConfig } from './config.js';
import { createBot } from './bot.js';
import { ClaudeCli } from './services/claude-cli.js';
import { SessionStore } from './services/session-store.js';
import { MessageQueue } from './services/message-queue.js';
import { ChannelManager } from './services/channel-manager.js';
import { MessageHandler } from './services/message-handler.js';
import { ActivityTracker } from './services/activity-tracker.js';
import { registerCommands } from './commands/index.js';
import { newSessionCommand } from './commands/new-session.js';
import { listSessionsCommand } from './commands/list-sessions.js';
import { connectSessionCommand } from './commands/connect-session.js';
import { endSessionCommand } from './commands/end-session.js';
import { sessionInfoCommand } from './commands/session-info.js';
import { logger } from './utils/logger.js';

async function main() {
  const config = loadConfig();

  // Initialize services
  const claudeCli = new ClaudeCli(config);
  const sessionStore = new SessionStore(config.sessionFilePath);
  const messageQueue = new MessageQueue();
  const activityTracker = new ActivityTracker();
  const channelManager = new ChannelManager(config.categoryName);

  // Load persisted sessions
  await sessionStore.load();

  // Build commands
  const commands = [
    newSessionCommand(claudeCli, sessionStore, channelManager),
    listSessionsCommand(sessionStore),
    connectSessionCommand(claudeCli, sessionStore, channelManager),
    endSessionCommand(sessionStore, channelManager, messageQueue),
    sessionInfoCommand(sessionStore),
  ];

  // Create bot and register commands
  const bot = createBot(config);
  for (const cmd of commands) {
    bot.registerCommand(cmd);
  }

  // Register message handler
  const messageHandler = new MessageHandler(
    claudeCli,
    sessionStore,
    messageQueue,
    activityTracker,
  );
  messageHandler.register(bot.client);

  // Register slash commands with Discord API
  await registerCommands(config, commands);

  // Graceful shutdown
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new interactions
    bot.client.removeAllListeners('messageCreate');
    bot.client.removeAllListeners('interactionCreate');

    // Wait for in-flight queue tasks
    await messageQueue.drain();

    // Final save
    await sessionStore.flush();

    // Disconnect from Discord
    bot.client.destroy();

    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Login
  await bot.login();
  logger.info('MindBridge is running');
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
