import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client, TextChannel } from 'discord.js';
import type { SessionStore } from './session-store.js';
import type { CliSessionReader } from './cli-session-reader.js';
import type { TaskController } from './task-controller.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

/**
 * Polls Claude CLI JSONL files for new assistant output that appeared outside
 * of bot-triggered requests (e.g. cron-scheduled tasks, terminal sessions).
 *
 * Tracking strategy: line count.
 *   - After every bot response, MessageHandler calls markSeen(sessionId, workDir)
 *     which snapshots the current JSONL line count as "already delivered".
 *   - On each poll cycle, new lines past that count are scanned for `result`
 *     entries. Any found are posted to the session's Discord channel.
 *   - Sessions with an active task are skipped — the bot is already streaming.
 */
export class ProactivePoller {
  private timer: NodeJS.Timeout | null = null;

  // sessionId → number of JSONL lines already delivered to Discord
  private readonly lastSeenLines = new Map<string, number>();

  constructor(
    private readonly sessionStore: SessionStore,
    private readonly cliSessionReader: CliSessionReader,
    private readonly taskController: TaskController,
    private readonly client: Client,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    logger.info(`Proactive poller started (interval: ${this.intervalMs / 1000}s)`);
    this.timer = setInterval(
      () => this.poll().catch(err => logger.error('Poller error:', err)),
      this.intervalMs,
    );
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('Proactive poller stopped');
  }

  /**
   * Call this after the bot finishes processing a session message (success or
   * error). Records the current JSONL line count so the poller knows these
   * lines have already been delivered and should not be re-posted.
   */
  async markSeen(sessionId: string, workDir?: string): Promise<void> {
    const resolvedWorkDir = workDir
      ?? await this.cliSessionReader.resolveWorkDir(sessionId).catch(() => null);
    if (!resolvedWorkDir) return;

    const lines = await this.readLines(sessionId, resolvedWorkDir);
    this.lastSeenLines.set(sessionId, lines.length);
  }

  // --- private ---

  private async poll(): Promise<void> {
    const mappings = this.sessionStore.getActiveMappings();
    await Promise.all(mappings.map(m => this.pollSession(m.sessionId, m.channelId, m.workDir)));
  }

  private async pollSession(
    sessionId: string,
    channelId: string,
    workDir: string | undefined,
  ): Promise<void> {
    // Never interfere with an in-flight bot task
    if (this.taskController.has(sessionId)) return;

    const resolvedWorkDir = workDir
      ?? await this.cliSessionReader.resolveWorkDir(sessionId).catch(() => null);
    if (!resolvedWorkDir) return;

    const lines = await this.readLines(sessionId, resolvedWorkDir);

    // First encounter — initialise and skip this cycle to avoid posting history
    if (!this.lastSeenLines.has(sessionId)) {
      this.lastSeenLines.set(sessionId, lines.length);
      return;
    }

    const lastSeen = this.lastSeenLines.get(sessionId)!;
    const newLines = lines.slice(lastSeen);

    // Always advance the pointer, even if we find nothing to post
    this.lastSeenLines.set(sessionId, lines.length);

    const results = this.extractResults(newLines);
    if (results.length === 0) return;

    await this.postToChannel(sessionId, channelId, results);
  }

  /**
   * Extract the final result text from `result` JSONL entries.
   * Skips error results and empty strings.
   */
  private extractResults(lines: string[]): string[] {
    const out: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (
          entry.type === 'result' &&
          !entry.is_error &&
          typeof entry.result === 'string' &&
          entry.result.trim()
        ) {
          out.push(entry.result.trim());
        }
      } catch {
        // skip malformed lines
      }
    }
    return out;
  }

  private async postToChannel(
    sessionId: string,
    channelId: string,
    results: string[],
  ): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
      if (!channel) {
        logger.warn(`Poller: channel ${channelId} not found for session ${sessionId}`);
        return;
      }

      for (const text of results) {
        const chunks = splitMessage(text);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }

      logger.info(`Poller: posted ${results.length} result(s) for session ${sessionId}`);
    } catch (err) {
      logger.warn(`Poller: failed to post for session ${sessionId}:`, err);
    }
  }

  /** Read all non-empty lines from a session JSONL file. */
  private async readLines(sessionId: string, workDir: string): Promise<string[]> {
    const filePath = join(this.cliSessionReader.getProjectDir(workDir), `${sessionId}.jsonl`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return content.split('\n').filter(l => l.trim().length > 0);
    } catch {
      return [];
    }
  }
}
