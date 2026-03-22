import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';

export function sessionInfoCommand(sessionStore: SessionStore): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('session-info')
      .setDescription('Show info about the current session (use in a session channel)'),

    async execute(interaction) {
      const session = sessionStore.findByChannelId(interaction.channelId);

      if (!session) {
        await interaction.reply({
          content: 'This channel is not linked to an active session.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Session: ${session.topic}`)
        .setColor(session.status === 'active' ? 0x7C3AED : 0xF59E0B)
        .addFields(
          { name: 'Status', value: session.status, inline: true },
          { name: 'Messages', value: String(session.messageCount), inline: true },
          { name: 'Session ID', value: `\`${session.id}\``, inline: false },
          { name: 'Created', value: `<t:${Math.floor(new Date(session.createdAt).getTime() / 1000)}:R>`, inline: true },
          { name: 'Last Active', value: `<t:${Math.floor(new Date(session.lastActiveAt).getTime() / 1000)}:R>`, inline: true },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    },
  };
}
