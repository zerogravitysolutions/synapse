import { SlashCommandBuilder, type TextChannel } from 'discord.js';
import type { Command } from '../types.js';
import type { SessionStore } from '../services/session-store.js';
import type { ActivityTracker } from '../services/activity-tracker.js';
import type { CliSessionReader } from '../services/cli-session-reader.js';
import { formatActivity, formatRecentActivity } from '../utils/format-activity.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

interface ActiveTimer {
  timer: NodeJS.Timeout;
  context: string | null;
}

const activeTimers = new Map<string, ActiveTimer>();

export function pingmeCommand(
  sessionStore: SessionStore,
  activityTracker: ActivityTracker,
  cliSessionReader: CliSessionReader,
): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('pingme')
      .setDescription('Auto-send progress updates at an interval — works for foreground and background sessions')
      .addStringOption(opt =>
        opt.setName('interval')
          .setDescription('Update interval (e.g. 5m, 30s, 1h) or "stop"')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('context')
          .setDescription('What you\'re trying to get from this job — shown on every update as a reminder')
          .setRequired(false)
      ),

    async execute(interaction) {
      const input = interaction.options.getString('interval', true).trim().toLowerCase();
      const context = interaction.options.getString('context')?.trim() || null;
      const channelId = interaction.channelId;

      // Stop existing timer
      if (input === 'stop' || input === '0') {
        const existing = activeTimers.get(channelId);
        if (existing) {
          clearInterval(existing.timer);
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
        await interaction.reply('No active session mapped to this channel.');
        return;
      }

      // Clear existing timer for this channel
      const existing = activeTimers.get(channelId);
      if (existing) {
        clearInterval(existing.timer);
      }

      const channel = interaction.channel as TextChannel;

      const timer = setInterval(async () => {
        try {
          const currentSession = sessionStore.findByChannelId(channelId);
          if (!currentSession) {
            clearInterval(timer);
            activeTimers.delete(channelId);
            return;
          }

          const update = await buildProgressUpdate(
            currentSession.sessionId,
            currentSession.workDir,
            context,
            activityTracker,
            cliSessionReader,
          );

          if (!update) {
            // No live activity AND no JSONL found — session truly has nothing.
            // Don't stop automatically; the user may be waiting for the job to start.
            logger.debug(`No activity data for session ${currentSession.sessionId}`);
            return;
          }

          const header = `### Scheduled Progress Update`;
          const chunks = splitMessage(`${header}\n${update}`);
          for (const chunk of chunks) {
            await channel.send(chunk).catch(err => {
              logger.warn('Failed to send auto-ping:', err);
            });
          }
        } catch (err) {
          logger.warn('pingme tick failed:', err);
        }
      }, ms);

      activeTimers.set(channelId, { timer, context });

      const label = formatMs(ms);
      const contextLine = context ? `\n> Watching for: *${context}*` : '';
      await interaction.reply(
        `Sending progress updates every **${label}**.${contextLine}\nUse \`/pingme interval:stop\` to cancel.`
      );
      logger.info(`Started auto-ping for channel ${channelId} every ${label}${context ? ` (context: "${context}")` : ''}`);
    },
  };
}

/**
 * Build a progress update. Prefers the live ActivityTracker (richest data)
 * but falls back to tailing the JSONL when the tracker is empty — e.g.
 * session is running detached, bot restarted mid-task, or task already finished.
 */
async function buildProgressUpdate(
  sessionId: string,
  workDir: string | undefined,
  context: string | null,
  activityTracker: ActivityTracker,
  cliSessionReader: CliSessionReader,
): Promise<string | null> {
  const live = activityTracker.get(sessionId);
  if (live) {
    const base = formatActivity(live);
    return context ? `> **You're watching for:** ${context}\n\n${base}` : base;
  }

  // Fallback: read recent activity from the JSONL.
  // If workDir is missing (shouldn't normally happen), try to resolve it.
  const resolvedWorkDir = workDir
    ?? (await cliSessionReader.resolveWorkDir(sessionId)) ?? null;
  if (!resolvedWorkDir) return null;

  const recent = await cliSessionReader.readRecentActivity(resolvedWorkDir, sessionId);
  if (!recent) return null;

  return formatRecentActivity(recent, context ?? undefined);
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
