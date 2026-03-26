import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import type { CliSessionReader } from '../services/cli-session-reader.js';
import { formatActivity } from '../utils/format-activity.js';

export function sessionInfoCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
  cliSessionReader: CliSessionReader,
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

      // Read live metadata from CLI JSONL
      const meta = session.workDir
        ? await cliSessionReader.readSessionMeta(session.workDir, session.sessionId)
        : null;

      const messageCount = meta?.messageCount ?? 0;

      // If Claude is actively working, show the activity embed
      const activity = activityTracker.get(session.sessionId);
      if (activity) {
        const statusEmbed = new EmbedBuilder()
          .setTitle(session.topic)
          .setColor(0x3B82F6)
          .addFields(
            { name: 'Status', value: `\`${session.status}\``, inline: true },
            { name: 'Messages', value: `\`${messageCount}\``, inline: true },
            { name: 'Session ID', value: `\`${session.sessionId}\``, inline: false },
          )
          .setTimestamp();

        const activityText = formatActivity(activity);
        await interaction.reply({ content: activityText, embeds: [statusEmbed] });
        return;
      }

      // Idle — show session info only
      const lastActive = meta?.lastActiveAt ? `<t:${Math.floor(new Date(meta.lastActiveAt).getTime() / 1000)}:R>` : 'Unknown';

      const embed = new EmbedBuilder()
        .setTitle(session.topic)
        .setDescription('Claude is idle — send a message to start working.')
        .setColor(0x3B82F6)
        .addFields(
          { name: 'Status', value: `\`${session.status}\``, inline: true },
          { name: 'Messages', value: `\`${messageCount}\``, inline: true },
          { name: 'Last Active', value: lastActive, inline: true },
          { name: 'Session ID', value: `\`${session.sessionId}\``, inline: false },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    },
  };
}
