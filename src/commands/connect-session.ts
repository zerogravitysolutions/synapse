import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { ClaudeCli } from '../services/claude-cli.js';
import type { SessionStore } from '../services/session-store.js';
import type { ChannelManager } from '../services/channel-manager.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

export function connectSessionCommand(
  claudeCli: ClaudeCli,
  sessionStore: SessionStore,
  channelManager: ChannelManager,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('connect-session')
      .setDescription('Connect to an existing Claude session')
      .addStringOption(opt =>
        opt.setName('session-id').setDescription('Full or partial session ID').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('topic').setDescription('Override topic name').setRequired(false)
      ),

    async execute(interaction) {
      const prefix = interaction.options.getString('session-id', true);
      const topicOverride = interaction.options.getString('topic');
      const guild = interaction.guild!;

      await interaction.deferReply();

      try {
        // Look up session by prefix
        const matches = sessionStore.findByPrefix(prefix);

        if (matches.length === 0) {
          await interaction.editReply(`No session found matching \`${prefix}\``);
          return;
        }
        if (matches.length > 1) {
          const ids = matches.map(s => `\`${s.id}\` (${s.topic})`).join('\n');
          await interaction.editReply(`Multiple sessions match. Be more specific:\n${ids}`);
          return;
        }

        const session = matches[0];
        const topic = topicOverride ?? session.topic;

        // Only check for existing channel if session is currently active
        if (session.status === 'active') {
          try {
            const existingChannel = await guild.channels.fetch(session.channelId);
            if (existingChannel) {
              await interaction.editReply(
                `Session already has a channel: <#${session.channelId}>`
              );
              return;
            }
          } catch {
            // Channel doesn't exist, we'll create a new one
          }
        }

        // Create new channel and resume session
        const channel = await channelManager.createSessionChannel(guild, topic, session.id);

        // Update session with new channel
        await sessionStore.update(session.id, {
          channelId: channel.id,
          status: 'active',
          topic,
          lastActiveAt: new Date().toISOString(),
        });

        // Ask Claude to summarize the previous conversation
        const result = await claudeCli.resumeSession(
          session.id,
          'Please provide a brief summary of our conversation so far.',
          session.workDir,
        );

        const embed = new EmbedBuilder()
          .setTitle(`Resumed: ${topic}`)
          .setDescription(result.text.slice(0, 4096))
          .setColor(0x10B981)
          .setFooter({ text: `Session ID: ${session.id}` })
          .setTimestamp();

        await channel.send({ embeds: [embed] });

        if (result.text.length > 4096) {
          const chunks = splitMessage(result.text.slice(4096));
          for (const chunk of chunks) {
            await channel.send(chunk);
          }
        }

        await interaction.editReply(`Session resumed! Head to <#${channel.id}>`);
        logger.info(`Reconnected session ${session.id}`);
      } catch (err) {
        logger.error('Failed to connect session:', err);
        await interaction.editReply(
          `Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    },
  };
}
