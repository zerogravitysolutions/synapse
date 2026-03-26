import { EmbedBuilder, SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { ClaudeCli } from '../services/claude-cli.js';
import type { SessionStore } from '../services/session-store.js';
import type { ChannelManager } from '../services/channel-manager.js';
import type { Config } from '../types.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

export function newSessionCommand(
  claudeCli: ClaudeCli,
  sessionStore: SessionStore,
  channelManager: ChannelManager,
  config: Config,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('new-session')
      .setDescription('Create a new Claude Code session')
      .addStringOption(opt =>
        opt.setName('topic').setDescription('Topic for the session').setRequired(true)
      ),

    async execute(interaction) {
      const topic = interaction.options.getString('topic', true);
      const guild = interaction.guild!;

      await interaction.deferReply();

      let channel: TextChannel | null = null;

      try {
        // 1. Start Claude session first to get the real session ID
        const result = await claudeCli.startSession(
          `You are starting a new session. The topic is: ${topic}. Introduce yourself briefly and confirm the topic.`
        );

        // 2. Create Discord channel with the real session ID
        channel = await channelManager.createSessionChannel(guild, topic, result.sessionId);

        // 3. Save session
        const now = new Date().toISOString();
        await sessionStore.create({
          id: result.sessionId,
          topic,
          status: 'active',
          channelId: channel.id,
          guildId: guild.id,
          createdAt: now,
          lastActiveAt: now,
          messageCount: 1,
          workDir: config.claudeWorkDir,
        });

        // 4. Post Claude's response in the new channel
        const embed = new EmbedBuilder()
          .setTitle(`Session: ${topic}`)
          .setDescription(result.text.slice(0, 4096))
          .setColor(0x7C3AED)
          .setFooter({ text: `Session ID: ${result.sessionId}` })
          .setTimestamp();

        await channel.send({ embeds: [embed] });

        // If response is very long, send the rest as regular messages
        if (result.text.length > 4096) {
          const remaining = result.text.slice(4096);
          const chunks = splitMessage(remaining);
          for (const chunk of chunks) {
            await channel.send(chunk);
          }
        }

        // 5. Reply to the slash command
        await interaction.editReply(
          `Session created! Head to <#${channel.id}> to start chatting.`
        );

        logger.info(`New session ${result.sessionId} created for topic "${topic}"`);
      } catch (err) {
        logger.error('Failed to create session:', err);

        // Clean up orphaned channel if it was created before the failure
        if (channel) {
          await channel.delete().catch(() => {});
        }

        await interaction.editReply(
          `Failed to create session: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    },
  };
}
