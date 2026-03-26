import { EmbedBuilder, SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { ClaudeCli } from '../services/claude-cli.js';
import type { SessionStore } from '../services/session-store.js';
import type { MessageQueue } from '../services/message-queue.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import { logger } from '../utils/logger.js';

export function resetCommand(
  claudeCli: ClaudeCli,
  sessionStore: SessionStore,
  messageQueue: MessageQueue,
  activityTracker: ActivityTracker,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('reset')
      .setDescription('Archive the current session and start fresh in the same channel'),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      await interaction.deferReply();

      // Enqueue to wait for any in-flight task to finish
      await messageQueue.enqueue(session.sessionId, async () => {
        const channel = interaction.channel as TextChannel;

        try {
          // Archive old session
          await sessionStore.update(session.sessionId, {
            status: 'archived',
            archivedAt: new Date().toISOString(),
          });
          messageQueue.remove(session.sessionId);
          activityTracker.clear(session.sessionId);

          // Start a fresh session
          const result = await claudeCli.startSession(
            `You are starting a fresh session. The topic is: ${session.topic}. The previous session was reset by the user. Introduce yourself briefly.`,
            session.workDir,
          );

          // Create new mapping pointing to the same channel
          await sessionStore.create({
            sessionId: result.sessionId,
            topic: session.topic,
            status: 'active',
            channelId: channel.id,
            guildId: session.guildId,
            workDir: session.workDir,
          });

          // Update channel topic
          await channel.setTopic(`Session: ${result.sessionId} | Topic: ${session.topic}`);

          const embed = new EmbedBuilder()
            .setTitle('Session Reset')
            .setDescription(result.text.slice(0, 4096))
            .setColor(0x10B981)
            .setFooter({ text: `New Session ID: ${result.sessionId}` })
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          logger.info(`Reset session in channel ${channel.id}: ${session.sessionId} -> ${result.sessionId}`);
        } catch (err) {
          logger.error('Failed to reset session:', err);
          await interaction.editReply(
            `Failed to reset: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
      });
    },
  };
}
