import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import { logger } from '../utils/logger.js';

export function setEffortCommand(sessionStore: SessionStore): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('set-effort')
      .setDescription('Set the effort level for the current session')
      .addStringOption(opt =>
        opt.setName('effort').setDescription('Effort level').setRequired(true)
          .addChoices(
            { name: 'low', value: 'low' },
            { name: 'medium', value: 'medium' },
            { name: 'high', value: 'high' },
            { name: 'max', value: 'max' },
          )
      ),

    async execute(interaction) {
      const effort = interaction.options.getString('effort', true);
      const session = sessionStore.findByChannelId(interaction.channelId);

      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', flags: 64 });
        return;
      }

      await sessionStore.update(session.sessionId, { effort });
      logger.info(`Effort set to "${effort}" for session ${session.sessionId}`);
      await interaction.reply(`Effort set to **${effort}** for this session.`);
    },
  };
}
