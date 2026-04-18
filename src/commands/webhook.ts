import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import { logger } from '../utils/logger.js';

export function webhookCommand(): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('webhook')
      .setDescription('Get or create a webhook for this channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks),

    async execute(interaction) {
      const channel = interaction.channel;

      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'This command can only be used in a text channel.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const textChannel = channel as TextChannel;

      try {
        const webhooks = await textChannel.fetchWebhooks();
        const botId = interaction.client.user?.id;
        const existing = webhooks.find(wh => wh.owner?.id === botId);

        if (existing) {
          logger.info(`Returning existing webhook for #${textChannel.name} (${textChannel.id})`);
          await interaction.editReply(
            `**Existing webhook found** for #${textChannel.name}\n\`\`\`\n${existing.url}\n\`\`\``
          );
          return;
        }

        const webhook = await textChannel.createWebhook({
          name: 'Synapse',
          reason: 'Created by /webhook command',
        });

        logger.info(`Created webhook for #${textChannel.name} (${textChannel.id})`);
        await interaction.editReply(
          `**Webhook created** for #${textChannel.name}\n\`\`\`\n${webhook.url}\n\`\`\``
        );
      } catch (err) {
        logger.error(`Webhook command failed in #${textChannel.name}:`, err);

        const message = err instanceof Error ? err.message : 'Unknown error';
        const isPermissionError = message.includes('Missing Permissions') || message.includes('50013');

        await interaction.editReply(
          isPermissionError
            ? 'The bot lacks the **Manage Webhooks** permission in this channel. Please update the bot\'s role permissions.'
            : `Failed to manage webhook: ${message}`
        );
      }
    },
  };
}
