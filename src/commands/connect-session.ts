import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command, Config } from '../types.js';
import type { ClaudeCli } from '../services/claude-cli.js';
import type { SessionStore } from '../services/session-store.js';
import type { ChannelManager } from '../services/channel-manager.js';
import type { CliSessionReader } from '../services/cli-session-reader.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

export function connectSessionCommand(
  claudeCli: ClaudeCli,
  sessionStore: SessionStore,
  channelManager: ChannelManager,
  cliSessionReader: CliSessionReader,
  config: Config,
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
        // First check our channel mappings
        const mappingMatches = sessionStore.findByPrefix(prefix);

        if (mappingMatches.length > 1) {
          const ids = mappingMatches.map(s => `\`${s.sessionId}\` (${s.topic})`).join('\n');
          await interaction.editReply(`Multiple sessions match. Be more specific:\n${ids}`);
          return;
        }

        let sessionId: string;
        let topic: string;
        let workDir: string | undefined;

        if (mappingMatches.length === 1) {
          // Known session — use existing mapping, but resolve workDir in case it's stale
          const mapping = mappingMatches[0];
          sessionId = mapping.sessionId;
          topic = topicOverride ?? mapping.topic;
          workDir = await cliSessionReader.resolveWorkDir(mapping.sessionId, mapping.workDir) ?? mapping.workDir;

          // Only check for existing channel if session is currently active
          if (mapping.status === 'active') {
            try {
              const existingChannel = await guild.channels.fetch(mapping.channelId);
              if (existingChannel) {
                await interaction.editReply(
                  `Session already has a channel: <#${mapping.channelId}>`
                );
                return;
              }
            } catch {
              // Channel doesn't exist, we'll create a new one
            }
          }
        } else {
          // No mapping — try to find the session in CLI JSONL files across all project dirs
          const allProjectDirs = await cliSessionReader.listAllProjectDirs();
          const workDirs = new Set([config.claudeWorkDir, ...allProjectDirs]);
          const cliMatches = await cliSessionReader.findSessionByPrefix(prefix, [...workDirs]);

          if (cliMatches.length === 0) {
            await interaction.editReply(`No session found matching \`${prefix}\``);
            return;
          }
          if (cliMatches.length > 1) {
            const ids = cliMatches.map(s => `\`${s.sessionId}\` (${s.aiTitle ?? 'Untitled'})`).join('\n');
            await interaction.editReply(`Multiple sessions match. Be more specific:\n${ids}`);
            return;
          }

          const cliSession = cliMatches[0];
          sessionId = cliSession.sessionId;
          topic = topicOverride ?? cliSession.aiTitle ?? 'Untitled';
          workDir = cliSession.workDir;
        }

        // Create new channel and resume session
        const channel = await channelManager.createSessionChannel(guild, topic, sessionId);

        // Create or update mapping
        if (mappingMatches.length === 1) {
          await sessionStore.update(sessionId, {
            channelId: channel.id,
            status: 'active',
            topic,
            workDir,
          });
        } else {
          await sessionStore.create({
            sessionId,
            topic,
            status: 'active',
            channelId: channel.id,
            guildId: guild.id,
            workDir,
          });
        }

        // Ask Claude to summarize the previous conversation
        try {
          const result = await claudeCli.resumeSession(
            sessionId,
            'Please provide a brief summary of our conversation so far.',
            workDir,
          );

          const embed = new EmbedBuilder()
            .setTitle(`Resumed: ${topic}`)
            .setDescription(result.text.slice(0, 4096))
            .setColor(0x10B981)
            .setFooter({ text: `Session ID: ${sessionId}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });

          if (result.text.length > 4096) {
            const chunks = splitMessage(result.text.slice(4096));
            for (const chunk of chunks) {
              await channel.send(chunk);
            }
          }
        } catch (resumeErr) {
          // Session may be in use or unavailable — channel is still linked
          logger.warn(`Could not resume session ${sessionId} for summary:`, resumeErr);
          const embed = new EmbedBuilder()
            .setTitle(`Connected: ${topic}`)
            .setDescription('Channel linked. Could not get a summary (session may be in use elsewhere).\nSend a message to start chatting.')
            .setColor(0xF59E0B)
            .setFooter({ text: `Session ID: ${sessionId}` })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
        }

        await interaction.editReply(`Session resumed! Head to <#${channel.id}>`);
        logger.info(`Connected session ${sessionId}`);
      } catch (err) {
        logger.error('Failed to connect session:', err);
        await interaction.editReply(
          `Failed to connect: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    },
  };
}
