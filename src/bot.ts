import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
} from 'discord.js';
import type { Command, Config } from './types.js';
import { logger } from './utils/logger.js';

export function createBot(config: Config) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const commands = new Collection<string, Command>();

  function registerCommand(command: Command) {
    commands.set(command.data.name, command);
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`Command ${interaction.commandName} failed:`, err);
      const reply = { content: 'An error occurred while executing this command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Bot logged in as ${readyClient.user.tag}`);
  });

  return {
    client,
    commands,
    registerCommand,
    login: () => client.login(config.discordToken),
  };
}
