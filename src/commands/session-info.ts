import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import { formatActivity } from '../utils/format-activity.js';

export function sessionInfoCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('session-info')
      .setDescription('Show info about the current session'),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);

      if (!session) {
        await interaction.reply({
          content: 'This channel is not linked to an active session.',
          ephemeral: true,
        });
        return;
      }

      // If Claude is actively working, show the activity embed
      const activity = activityTracker.get(session.id);
      if (activity) {
        const statusEmbed = new EmbedBuilder()
          .setTitle(session.topic)
          .setColor(0x3B82F6)
          .addFields(
            { name: 'Status', value: `\`${session.status}\``, inline: true },
            { name: 'Messages', value: `\`${session.messageCount}\``, inline: true },
            { name: 'Session ID', value: `\`${session.id}\``, inline: false },
          )
          .setTimestamp();

        const activityText = formatActivity(activity);
        await interaction.reply({ content: activityText, embeds: [statusEmbed] });
        return;
      }

      // Idle — show session info only
      const embed = new EmbedBuilder()
        .setTitle(session.topic)
        .setDescription('Claude is idle — send a message to start working.')
        .setColor(0x3B82F6)
        .addFields(
          { name: 'Status', value: `\`${session.status}\``, inline: true },
          { name: 'Messages', value: `\`${session.messageCount}\``, inline: true },
          { name: 'Last Active', value: `<t:${Math.floor(new Date(session.lastActiveAt).getTime() / 1000)}:R>`, inline: true },
          { name: 'Session ID', value: `\`${session.id}\``, inline: false },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    },
  };
}
