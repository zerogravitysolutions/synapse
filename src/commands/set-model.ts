import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import { logger } from '../utils/logger.js';

export function setModelCommand(sessionStore: SessionStore): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('set-model')
      .setDescription('Set the Claude model for the current session')
      .addStringOption(opt =>
        opt.setName('model').setDescription('Model alias or full name (e.g. opus, sonnet, claude-opus-4-5)').setRequired(true)
      ),

    async execute(interaction) {
      const model = interaction.options.getString('model', true);
      const session = sessionStore.findByChannelId(interaction.channelId);

      if (!session) {
        await interaction.reply({ content: 'No active session in this channel.', flags: 64 });
        return;
      }

      await sessionStore.update(session.sessionId, { model });
      logger.info(`Model set to "${model}" for session ${session.sessionId}`);
      await interaction.reply(`Model set to **${model}** for this session.`);
    },
  };
}
