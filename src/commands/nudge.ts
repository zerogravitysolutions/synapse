import { SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ClaudeCli } from '../services/claude-cli.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

export function nudgeCommand(
  sessionStore: SessionStore,
  claudeCli: ClaudeCli,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('nudge')
      .setDescription('Send a parallel instruction to Claude without interrupting the current task')
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription('Instruction to send alongside the running task')
          .setRequired(true)
      ),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);
      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', ephemeral: true });
        return;
      }

      const nudgeMessage = interaction.options.getString('message', true);

      // Acknowledge immediately — the parallel call may take a while
      await interaction.reply(`> **Nudge sent** — running in parallel with the current task...\n> *"${nudgeMessage}"*`);

      const channel = interaction.channel as TextChannel;

      logger.info(`Nudge sent to session ${session.id}: "${nudgeMessage}"`);

      try {
        // Fork the session — preserves full context, avoids race conditions with the running task
        const result = await claudeCli.forkSession(
          session.id,
          `[Parallel nudge from user — respond to this while your current task continues]: ${nudgeMessage}`,
        );

        if (!result.text.trim()) {
          await channel.send('> **Nudge:** Claude acknowledged but returned no text.');
          return;
        }

        const prefix = '> **Nudge response:**\n';
        const chunks = splitMessage(result.text);
        await channel.send(prefix + chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await channel.send(chunks[i]);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error(`Nudge failed for session ${session.id}:`, err);
        await channel.send(`> **Nudge failed:** ${errorMessage}`);
      }
    },
  };
}
