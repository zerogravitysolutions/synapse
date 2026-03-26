import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { CliSessionReader } from '../services/cli-session-reader.js';

export function listSessionsCommand(
  sessionStore: SessionStore,
  cliSessionReader: CliSessionReader,
  workDir: string,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('list-sessions')
      .setDescription('List Claude sessions')
      .addBooleanOption(opt =>
        opt.setName('all').setDescription('Include archived/unlinked sessions').setRequired(false)
      ),

    async execute(interaction) {
      await interaction.deferReply();

      // Collect all unique workDirs: the default + any from channel mappings
      const allMappings = sessionStore.getAllMappings();
      const workDirs = new Set([workDir, ...allMappings.map(m => m.workDir).filter(Boolean) as string[]]);

      // Read CLI sessions from all project directories
      const cliSessionArrays = await Promise.all(
        [...workDirs].map(dir => cliSessionReader.listAllSessions(dir))
      );
      const cliSessions = cliSessionArrays.flat()
        .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());

      if (cliSessions.length === 0) {
        await interaction.editReply('No sessions found.');
        return;
      }

      // Build a lookup of channel mappings by sessionId
      const mappingById = new Map(allMappings.map(m => [m.sessionId, m]));

      const showAll = interaction.options.getBoolean('all') ?? false;

      // Merge CLI sessions with channel mappings
      const rows: { title: string; id: string; messages: number; ago: string; linked: boolean; channelId?: string; archived: boolean }[] = [];

      for (const cli of cliSessions) {
        const mapping = mappingById.get(cli.sessionId);
        const archived = mapping?.status === 'archived';

        // Default: show only active/linked sessions. With `all`, show everything.
        if (!showAll && archived) continue;

        rows.push({
          title: mapping?.topic ?? cli.aiTitle ?? 'Untitled',
          id: cli.sessionId,
          messages: cli.messageCount,
          ago: timeSince(new Date(cli.lastActiveAt)),
          linked: mapping?.status === 'active',
          channelId: mapping?.channelId,
          archived,
        });
      }

      if (rows.length === 0) {
        await interaction.editReply('No active sessions.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(showAll ? 'All Sessions' : 'Sessions')
        .setColor(0x7C3AED)
        .setTimestamp();

      for (const row of rows.slice(0, 25)) {
        const channel = row.channelId ? ` | <#${row.channelId}>` : '';
        const status = row.archived ? ' [archived]' : row.linked ? '' : ' [unlinked]';
        embed.addFields({
          name: row.title,
          value: `ID: \`${row.id}\` | Messages: ${row.messages} | ${row.ago}${channel}${status}`,
          inline: false,
        });
      }

      if (rows.length > 25) {
        embed.setFooter({ text: `Showing 25 of ${rows.length} sessions` });
      }

      await interaction.editReply({ embeds: [embed] });
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
