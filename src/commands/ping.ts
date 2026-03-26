import { SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import { formatActivity } from '../utils/format-activity.js';
import { splitMessage } from '../utils/split-message.js';

export function pingCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('See goal, progress, tools used, current action, and duration'),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      const activity = activityTracker.get(session.sessionId);
      if (!activity) {
        await interaction.reply('No active task. Claude is idle.');
        return;
      }

      const full = `### Progress Update\n${formatActivity(activity)}`;
      const chunks = splitMessage(full);
      await interaction.reply(chunks[0]);
      const channel = interaction.channel as TextChannel;
      for (let i = 1; i < chunks.length; i++) {
        await channel.send(chunks[i]);
      }
    },
  };
}
