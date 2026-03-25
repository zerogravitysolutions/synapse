import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import type { TaskController } from '../services/task-controller.js';
import { logger } from '../utils/logger.js';

export function injectCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
  taskController: TaskController,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('inject')
      .setDescription('Interrupt the running task at the next tool boundary and send a new instruction')
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription('Instruction to inject — Claude will handle it, then wait for you')
          .setRequired(true)
      ),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      const injectMessage = interaction.options.getString('message', true);

      if (!taskController.has(session.id)) {
        await interaction.reply({ content: 'No task is currently running. Just send your message normally.', ephemeral: true });
        return;
      }

      const activity = activityTracker.get(session.id);
      const currentAction = activity?.description ?? 'current tool';

      const queued = taskController.requestInject(session.id, injectMessage);

      if (!queued) {
        await interaction.reply({ content: 'Could not queue inject — task may have just finished.', ephemeral: true });
        return;
      }

      logger.info(`Inject queued for session ${session.id}: "${injectMessage}"`);

      await interaction.reply(
        `> **Inject queued** — will fire at the next tool boundary\n` +
        `> Currently: *${currentAction}*\n` +
        `> Inject: *"${injectMessage}"*`
      );
    },
  };
}
