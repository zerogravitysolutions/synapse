import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';

export function listSessionsCommand(sessionStore: SessionStore): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('list-sessions')
      .setDescription('List Claude sessions')
      .addBooleanOption(opt =>
        opt.setName('all').setDescription('Include archived sessions').setRequired(false)
      ),

    async execute(interaction) {
      const showAll = interaction.options.getBoolean('all') ?? false;
      const sessions = showAll ? sessionStore.getAllSessions() : sessionStore.getActiveSessions();

      if (sessions.length === 0) {
        await interaction.reply({ content: 'No active sessions.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(showAll ? 'All Sessions' : 'Active Sessions')
        .setColor(0x7C3AED)
        .setTimestamp();

      for (const session of sessions.slice(0, 25)) {
        const lastActive = new Date(session.lastActiveAt);
        const ago = timeSince(lastActive);
        embed.addFields({
          name: session.topic,
          value: `ID: \`${session.id}\` | Messages: ${session.messageCount} | Last active: ${ago}`,
          inline: false,
        });
      }

      if (sessions.length > 25) {
        embed.setFooter({ text: `Showing 25 of ${sessions.length} sessions` });
      }

      await interaction.reply({ embeds: [embed] });
    },
  };
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
