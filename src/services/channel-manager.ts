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

  constructor(categoryName: string) {
    this.categoryName = categoryName;
  }

  private async findOrCreateCategory(guild: Guild): Promise<CategoryChannel> {
    const existing = guild.channels.cache.find(
      ch => ch.type === ChannelType.GuildCategory && ch.name === this.categoryName
    ) as CategoryChannel | undefined;

    if (existing) return existing;

    logger.info(`Creating category "${this.categoryName}" in guild ${guild.id}`);
    const category = await guild.channels.create({
      name: this.categoryName,
      type: ChannelType.GuildCategory,
    });
    return category;
  }

  async createSessionChannel(
    guild: Guild,
    topic: string,
    sessionId: string,
  ): Promise<TextChannel> {
    const category = await this.findOrCreateCategory(guild);
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

  async renameChannelArchived(channel: TextChannel): Promise<void> {
    const newName = `archived-${channel.name}`.slice(0, 100);
    await channel.setName(newName);
    logger.info(`Renamed channel to "${newName}"`);
  }
}
