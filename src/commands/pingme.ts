import { SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import { formatActivity } from '../utils/format-activity.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

const activeTimers = new Map<string, NodeJS.Timeout>();

export function pingmeCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('pingme')
      .setDescription('Auto-send progress updates (goal, steps, tools, duration) at an interval')
      .addStringOption(opt =>
        opt.setName('interval').setDescription('Update interval (e.g. 5m, 30s, 1h) or "stop"').setRequired(true)
      ),

    async execute(interaction) {
      const input = interaction.options.getString('interval', true).trim().toLowerCase();
      const channelId = interaction.channelId;

      // Stop existing timer
      if (input === 'stop' || input === '0') {
        const existing = activeTimers.get(channelId);
        if (existing) {
          clearInterval(existing);
          activeTimers.delete(channelId);
          await interaction.reply('Stopped periodic progress updates.');
        } else {
          await interaction.reply('No active ping timer in this channel.');
        }
        return;
      }

      // Parse interval
      const ms = parseInterval(input);
      if (!ms || ms < 10_000) {
        await interaction.reply('Invalid interval. Use e.g. `30s`, `5m`, `1h`. Minimum 10s.');
        return;
      }

      const session = sessionStore.findByChannelId(channelId);
      if (!session) {
        await interaction.reply('No active session in this channel.');
        return;
      }

      // Clear existing timer for this channel
      const existing = activeTimers.get(channelId);
      if (existing) {
        clearInterval(existing);
      }

      const channel = interaction.channel as TextChannel;

      // Capture the taskId of the current task so we stop when it changes
      const currentActivity = activityTracker.get(session.id);
      const startTaskId = currentActivity?.taskId ?? 0;

      const timer = setInterval(async () => {
        const currentSession = sessionStore.findByChannelId(channelId);
        if (!currentSession) {
          clearInterval(timer);
          activeTimers.delete(channelId);
          return;
        }

        const activity = activityTracker.get(currentSession.id);

        // Stop if: no activity, or the task changed (old task finished, new one started)
        if (!activity || (startTaskId && activity.taskId !== startTaskId)) {
          clearInterval(timer);
          activeTimers.delete(channelId);
          await channel.send('Auto-ping stopped — task completed.').catch(() => {});
          return;
        }

        const status = formatActivity(activity);
        const full = `### Scheduled Progress Update\n${status}`;
        const chunks = splitMessage(full);
        for (const chunk of chunks) {
          await channel.send(chunk).catch(err => {
            logger.warn('Failed to send auto-ping:', err);
          });
        }
      }, ms);

      activeTimers.set(channelId, timer);

      const label = formatMs(ms);
      await interaction.reply(`Sending progress updates every **${label}**. Use \`/pingme interval:stop\` to cancel.`);
      logger.info(`Started auto-ping for channel ${channelId} every ${label}`);
    },
  };
}

function parseInterval(input: string): number | null {
  const match = input.match(/^(\d+)\s*(s|m|h)$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  if (value <= 0) return null;
  const unit = match[2];
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60_000;
  if (unit === 'h') return value * 3_600_000;
  return null;
}

function formatMs(ms: number): string {
  if (ms < 60_000) return `${ms / 1000}s`;
  if (ms < 3_600_000) return `${ms / 60_000}m`;
  return `${ms / 3_600_000}h`;
}
