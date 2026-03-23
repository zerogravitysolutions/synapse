import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import type { MessageQueue } from '../services/message-queue.js';
import type { TaskController } from '../services/task-controller.js';
import { logger } from '../utils/logger.js';

export function stopCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
  messageQueue: MessageQueue,
  taskController: TaskController,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Cancel the running task'),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      if (!taskController.abort(session.id)) {
        await interaction.reply('No task running.');
        return;
      }

      messageQueue.remove(session.id);
      activityTracker.clear(session.id);

      await interaction.reply('Task cancelled.');
      logger.info(`User stopped task for session ${session.id}`);
    },
  };
}
