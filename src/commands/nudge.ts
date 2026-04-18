import { SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ClaudeCli } from '../services/claude-cli.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

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

      await interaction.deferReply();

      const channel = interaction.channel as TextChannel;

      try {
        // Always fork fresh from the main session so the aside has
        // the latest context up through main's most recent completed turn.
        // Trade-off: asides don't accumulate history across calls — that's
        // intentional, otherwise asides would drift from main state.
        logger.info(`Aside (fresh fork from main) for session ${session.sessionId}: "${asideMessage}"`);
        const result = await claudeCli.forkSession(
          session.sessionId,
          `[Aside from user — the main task is running in parallel; answer only this question and do not touch the main task state]: ${asideMessage}`,
          session.workDir,
        );

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
        logger.error(`Aside failed for session ${session.sessionId}:`, err);
        await interaction.editReply(`> **Aside failed:** ${errorMessage}`);
      }
    },
  };
}
