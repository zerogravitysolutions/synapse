import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import type { TaskController } from '../services/task-controller.js';
import { logger } from '../utils/logger.js';

export function interruptCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
  taskController: TaskController,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('interrupt')
      .setDescription('Stop the current task at the next tool boundary and redirect Claude to a new instruction')
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription('New instruction — Claude will handle it, then wait for your next message')
          .setRequired(true)
      ),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      const interruptMessage = interaction.options.getString('message', true);

      if (!taskController.has(session.sessionId)) {
        await interaction.reply({ content: 'No task is currently running. Just send your message normally.', ephemeral: true });
        return;
      }

      const activity = activityTracker.get(session.sessionId);
      const currentAction = activity?.description ?? 'current tool';

      const queued = taskController.requestInject(session.sessionId, interruptMessage);

      if (!queued) {
        await interaction.reply({ content: 'Could not queue interrupt — task may have just finished.', ephemeral: true });
        return;
      }

      logger.info(`Interrupt queued for session ${session.sessionId}: "${interruptMessage}"`);

      await interaction.reply(
        `> **Interrupt queued** — will fire at the next tool boundary\n` +
        `> Currently: *${currentAction}*\n` +
        `> Instruction: *"${interruptMessage}"*`
      );
    },
  };
}
