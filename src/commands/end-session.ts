import { EmbedBuilder, SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ChannelManager } from '../services/channel-manager.js';
import type { MessageQueue } from '../services/message-queue.js';
import { logger } from '../utils/logger.js';

export function endSessionCommand(
  sessionStore: SessionStore,
  channelManager: ChannelManager,
  messageQueue: MessageQueue,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('end-session')
      .setDescription('Archive a Claude session (defaults to the session in this channel)')
      .addStringOption(opt =>
        opt.setName('session-id').setDescription('Full or partial session ID').setRequired(false)
      ),

    async execute(interaction) {
      const prefix = interaction.options.getString('session-id');
      const guild = interaction.guild!;

      await interaction.deferReply();

      try {
        let session;

        if (prefix) {
          const matches = sessionStore.findByPrefix(prefix);
          if (matches.length === 0) {
            await interaction.editReply(`No session found matching \`${prefix}\``);
            return;
          }
          if (matches.length > 1) {
            const ids = matches.map(s => `\`${s.sessionId}\` (${s.topic})`).join('\n');
            await interaction.editReply(`Multiple sessions match. Be more specific:\n${ids}`);
            return;
          }
          session = matches[0];
        } else {
          session = sessionStore.findByChannelId(interaction.channelId);
          if (!session) {
            await interaction.editReply('No session linked to this channel. Use `session-id` to specify one.');
            return;
          }
        }

        if (session.status === 'archived') {
          await interaction.editReply(
            `Session \`${session.sessionId}\` is already archived.`
          );
          return;
        }

        const now = new Date().toISOString();

        // Archive the session
        await sessionStore.update(session.sessionId, {
          status: 'archived',
          archivedAt: now,
        });

        // Clean up message queue
        messageQueue.remove(session.sessionId);

        // Post archival notice and rename channel
        try {
          const channel = await guild.channels.fetch(session.channelId) as TextChannel | null;
          if (channel) {
            const embed = new EmbedBuilder()
              .setTitle('Session Archived')
              .setDescription(`This session has been archived. Use \`/connect-session session-id:${session.sessionId}\` to resume.`)
              .setColor(0xF59E0B)
              .setTimestamp();

            await channel.send({ embeds: [embed] });
            await channelManager.moveChannelToArchive(guild, channel);
          }
        } catch {
          // Channel may already be deleted
        }

        await interaction.editReply(`Session \`${session.sessionId}\` archived.`);
        logger.info(`Archived session ${session.sessionId}`);
      } catch (err) {
        logger.error('Failed to end session:', err);
        await interaction.editReply(
          `Failed to archive: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    },
  };
}
