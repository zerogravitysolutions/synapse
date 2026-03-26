import {
  ChannelType,
  type CategoryChannel,
  type Guild,
  type TextChannel,
} from 'discord.js';
import { sanitizeChannelName } from '../utils/sanitize.js';
import { logger } from '../utils/logger.js';

export class ChannelManager {
  private categoryName: string;
  private archiveCategoryName: string;

  constructor(categoryName: string, archiveCategoryName: string) {
    this.categoryName = categoryName;
    this.archiveCategoryName = archiveCategoryName;
  }

  private async findOrCreateCategory(guild: Guild, name: string): Promise<CategoryChannel> {
    const existing = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildCategory && ch.name === name
    ) as CategoryChannel | undefined;

    if (existing) return existing;

    logger.info(`Creating category "${name}" in guild ${guild.id}`);
    return guild.channels.create({ name, type: ChannelType.GuildCategory });
  }

  async createSessionChannel(
    guild: Guild,
    topic: string,
    sessionId: string,
  ): Promise<TextChannel> {
    const category = await this.findOrCreateCategory(guild, this.categoryName);
    const channelName = sanitizeChannelName(topic, sessionId.slice(0, 6));

    logger.info(`Creating channel "${channelName}" under "${this.categoryName}"`);
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Session: ${sessionId} | Topic: ${topic}`,
    });

    return channel;
  }

  async moveChannelToArchive(guild: Guild, channel: TextChannel): Promise<void> {
    const archiveCategory = await this.findOrCreateCategory(guild, this.archiveCategoryName);
    await channel.setParent(archiveCategory.id, { lockPermissions: false });
    logger.info(`Moved channel "${channel.name}" to "${this.archiveCategoryName}"`);
  }
}
