import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import type { MessageQueue } from '../services/message-queue.js';
import type { TaskController } from '../services/task-controller.js';
import { logger } from '../utils/logger.js';

const FILE_TOOLS = new Set(['Edit', 'Write']);

export function stopCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
  messageQueue: MessageQueue,
  taskController: TaskController,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Cancel the running task (waits for file edits to finish)'),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      if (!taskController.has(session.id)) {
        await interaction.reply('No task running.');
        return;
      }

      const activity = activityTracker.get(session.id);
      const currentTool = activity?.toolName;

      if (currentTool && FILE_TOOLS.has(currentTool)) {
        // Graceful — wait for file edit/write to finish, then kill
        taskController.requestGracefulStop(session.id);
        messageQueue.remove(session.id);
        await interaction.reply(`Stopping after current file operation finishes (\`${activity?.description ?? currentTool}\`)...`);
        logger.info(`Graceful stop requested for session ${session.id} (tool: ${currentTool})`);
      } else {
        // Immediate — safe to kill now
        taskController.abort(session.id);
        messageQueue.remove(session.id);
        activityTracker.clear(session.id);
        await interaction.reply('Task cancelled.');
        logger.info(`User stopped task for session ${session.id}`);
      }
    },
  };
}
