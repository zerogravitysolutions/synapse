import { SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import type { ClaudeCli } from '../services/claude-cli.js';
import type { TaskController } from '../services/task-controller.js';
import { formatActivity } from '../utils/format-activity.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

export function pingCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
  claudeCli: ClaudeCli,
  taskController: TaskController,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Check status, or send a nudge/inject to the running task')
      .addStringOption(option =>
        option
          .setName('nudge')
          .setDescription('Send a parallel instruction via a fork session (no interruption)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('inject')
          .setDescription('Stop at next tool boundary and inject this instruction')
          .setRequired(false)
      ),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      const nudgeMessage = interaction.options.getString('nudge');
      const injectMessage = interaction.options.getString('inject');

      // ── Nudge: fork session, run in parallel, no interruption ──────────────
      if (nudgeMessage) {
        await interaction.deferReply();
        logger.info(`Nudge (via /ping) for session ${session.id}: "${nudgeMessage}"`);

        try {
          const result = await claudeCli.forkSession(session.id, nudgeMessage);
          const text = result.text.trim() || '*(no response)*';
          const reply = `> **Nudge response:**\n${text}`;
          const chunks = splitMessage(reply);
          await interaction.editReply(chunks[0]);
          const channel = interaction.channel as TextChannel;
          for (let i = 1; i < chunks.length; i++) {
            await channel.send(chunks[i]);
          }
        } catch (err) {
          logger.error(`Nudge failed for session ${session.id}:`, err);
          await interaction.editReply(`> **Nudge failed:** ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        return;
      }

      // ── Inject: stop at next tool boundary, send instruction ───────────────
      if (injectMessage) {
        if (!taskController.has(session.id)) {
          await interaction.reply({ content: 'No task is currently running. Just send your message normally.', ephemeral: true });
          return;
        }

        const queued = taskController.requestInject(session.id, injectMessage);
        if (!queued) {
          await interaction.reply({ content: 'Could not queue inject — task may have just finished.', ephemeral: true });
          return;
        }

        const activity = activityTracker.get(session.id);
        const currentAction = activity?.description ?? 'current tool';

        logger.info(`Inject (via /ping) queued for session ${session.id}: "${injectMessage}"`);

        await interaction.reply(
          `> **Inject queued** — will fire at the next tool boundary\n` +
          `> Currently: *${currentAction}*\n` +
          `> Inject: *"${injectMessage}"*`
        );
        return;
      }

      // ── Default: status check ───────────────────────────────────────────────
      const activity = activityTracker.get(session.id);
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
