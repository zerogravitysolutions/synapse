import { SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ClaudeCli } from '../services/claude-cli.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

// Track forked session IDs per main session
const forkSessions = new Map<string, string>();

export function asideCommand(
  sessionStore: SessionStore,
  claudeCli: ClaudeCli,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('aside')
      .setDescription('Ask Claude a side question without interrupting the running task')
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription('Your question or instruction — runs in parallel with the current task')
          .setRequired(true)
      ),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      const asideMessage = interaction.options.getString('message', true);
      const existingFork = forkSessions.get(session.id);

      await interaction.deferReply();

      const channel = interaction.channel as TextChannel;

      try {
        let result;

        if (existingFork) {
          // Resume existing fork
          logger.info(`Aside (resume fork ${existingFork}) for session ${session.id}: "${asideMessage}"`);
          try {
            result = await claudeCli.resumeSession(existingFork, asideMessage, session.workDir);
          } catch {
            // Fork session lost — create a new one
            logger.info(`Fork ${existingFork} not found, creating new fork`);
            forkSessions.delete(session.id);
            result = await claudeCli.forkSession(session.id, `[Aside from user]: ${asideMessage}`, session.workDir);
            forkSessions.set(session.id, result.sessionId);
          }
        } else {
          // First aside — fork the session
          logger.info(`Aside (new fork) for session ${session.id}: "${asideMessage}"`);
          result = await claudeCli.forkSession(session.id, `[Aside from user]: ${asideMessage}`, session.workDir);
          forkSessions.set(session.id, result.sessionId);
        }

        if (!result.text.trim()) {
          await interaction.editReply('> **Aside:** Claude acknowledged but returned no text.');
          return;
        }

        const chunks = splitMessage(result.text);
        await interaction.editReply(`> **Aside:**\n${chunks[0]}`);
        for (let i = 1; i < chunks.length; i++) {
          await channel.send(chunks[i]);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error(`Aside failed for session ${session.id}:`, err);
        await interaction.editReply(`> **Aside failed:** ${errorMessage}`);
      }
    },
  };
}
