import { REST, Routes } from 'discord.js';
import type { Command, Config } from '../types.js';
import { logger } from '../utils/logger.js';

export async function registerCommands(
  config: Config,
  commands: Command[],
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const commandData = commands.map(c => c.data.toJSON());

  logger.info(`Registering ${commandData.length} global slash commands...`);

  await rest.put(
    Routes.applicationCommands(config.discordAppId),
    { body: commandData },
  );

  logger.info('Slash commands registered successfully');
}
