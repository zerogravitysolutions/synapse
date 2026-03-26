import type { Client, Message, TextChannel } from 'discord.js';
import { EmbedBuilder, Events } from 'discord.js';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeCli } from './claude-cli.js';
import type { CliResult } from '../types.js';
import type { SessionStore } from './session-store.js';
import type { MessageQueue } from './message-queue.js';
import type { ActivityTracker, SessionActivity } from './activity-tracker.js';
import type { TaskController } from './task-controller.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

export class MessageHandler {
  private claudeCli: ClaudeCli;
  private sessionStore: SessionStore;
  private messageQueue: MessageQueue;
  private activityTracker: ActivityTracker;
  private taskController: TaskController;

  constructor(
    claudeCli: ClaudeCli,
    sessionStore: SessionStore,
    messageQueue: MessageQueue,
    activityTracker: ActivityTracker,
    taskController: TaskController,
  ) {
    this.claudeCli = claudeCli;
    this.sessionStore = sessionStore;
    this.messageQueue = messageQueue;
    this.activityTracker = activityTracker;
    this.taskController = taskController;
  }

  register(client: Client): void {
    client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch(err => {
        logger.error('Message handler error:', err);
      });
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.inGuild()) return;

    const session = this.sessionStore.findByChannelId(message.channelId);
    if (!session) return;

    const content = message.content.trim();
    if (!content && !message.attachments.size) return;

    // Forward to Claude via queue
    this.messageQueue.enqueue(session.id, async () => {
      await this.forwardToClaude(message, session.id, session.workDir);
    });
  }

  private async forwardToClaude(message: Message, sessionId: string, workDir?: string): Promise<void> {
    const channel = message.channel as TextChannel;
    const stopTyping = this.startTyping(channel);

    this.activityTracker.update(sessionId, 'Processing your message...');

    const abortController = this.taskController.create(sessionId);

    try {
      const attachmentPaths = await this.downloadAttachments(message);
      let content = message.content;
      if (attachmentPaths.length > 0) {
        const fileList = attachmentPaths
          .map(p => `  ${p}`)
          .join('\n');
        content += `\n\n[Attached files — use the Read tool to view them:\n${fileList}]`;
      }

      const result = await this.claudeCli.streamResumeSession(
        sessionId,
        content,
        {
          onActivity: (description, toolName, purpose) => {
            logger.debug(`Activity update [${sessionId}]: ${description} (tool: ${toolName ?? 'none'})`);
            this.activityTracker.update(sessionId, description, toolName, purpose);
            // Log every tool action to the step-by-step action log
            if (toolName) {
              this.activityTracker.logAction(sessionId, toolName, description, purpose);
            }
          },
          onToolUse: (toolName) => {
            this.activityTracker.countTool(sessionId, toolName);
          },
          onGoal: (goal) => {
            this.activityTracker.setGoal(sessionId, goal);
          },
          onSkillUse: (skillName) => {
            this.activityTracker.addSkill(sessionId, skillName);
          },
          onTodoUpdate: (todos) => {
            this.activityTracker.updateTodos(sessionId, todos.map(t => ({
              id: String(t.id),
              content: String(t.content),
              status: (t.status === 'completed' ? 'completed' : t.status === 'in_progress' ? 'in_progress' : 'pending') as 'pending' | 'in_progress' | 'completed',
            })));
          },
          onToolComplete: () => {
            this.taskController.checkGracefulStop(sessionId);
          },
        },
        abortController,
        workDir,
      );

      // Snapshot activity before clearing — used for summary if result is empty
      const activity = this.activityTracker.get(sessionId);
      const activitySnapshot = activity ? { ...activity, toolCounts: { ...activity.toolCounts }, completedSteps: [...activity.completedSteps], usedSkills: [...activity.usedSkills], actionLog: [...activity.actionLog] } : null;

      stopTyping();
      this.activityTracker.clear(sessionId);
      this.taskController.remove(sessionId);

      await this.sessionStore.update(sessionId, {
        lastActiveAt: new Date().toISOString(),
        messageCount: (this.sessionStore.get(sessionId)?.messageCount ?? 0) + 1,
      });

      const filesToSend = await this.collectAttachableFiles(result.text);

      // Handle empty responses — build a summary from activity data
      if (!result.text.trim()) {
        if (result.isError) {
          logger.warn(`Claude returned an empty error for session ${sessionId}`);
          await channel.send({ embeds: [new EmbedBuilder().setDescription('Claude returned an error with no details.').setColor(0xEF4444)] });
        } else {
          const summary = this.buildActivitySummary(activitySnapshot, result);
          const summaryChunks = splitMessage(summary);
          for (let i = 0; i < summaryChunks.length; i++) {
            const isLast = i === summaryChunks.length - 1;
            if (isLast && filesToSend.length > 0) {
              await channel.send({ content: summaryChunks[i], files: filesToSend });
            } else {
              await channel.send(summaryChunks[i]);
            }
          }
        }
        return;
      }

      const chunks = splitMessage(result.text);
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        if (isLast && filesToSend.length > 0) {
          await channel.send({ content: chunks[i], files: filesToSend });
        } else {
          await channel.send(chunks[i]);
        }
      }

      if (result.isError) {
        logger.warn(`Claude returned an error for session ${sessionId}: ${result.text}`);
      }
    } catch (err) {
      stopTyping();
      this.activityTracker.clear(sessionId);

      // Check for pending inject before removing — consume it first
      const injectMessage = this.taskController.consumeInject(sessionId);
      this.taskController.remove(sessionId);

      // Aborted — either /stop or /interrupt
      if (abortController.signal.aborted) {
        if (injectMessage) {
          // Re-enqueue the inject message as the next task
          logger.info(`Inject triggered for session ${sessionId}: "${injectMessage}"`);
          this.messageQueue.enqueue(sessionId, async () => {
            await this.sendInject(channel, sessionId, injectMessage);
          });
        }
        return;
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Claude call failed for session ${sessionId}:`, err);

      const embed = new EmbedBuilder()
        .setTitle('Error')
        .setDescription(errorMessage)
        .setColor(0xEF4444)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }
  }

  /** Send an inject message to Claude — stops at tool boundary, sends, then waits for user. */
  private async sendInject(channel: TextChannel, sessionId: string, injectMessage: string): Promise<void> {
    const stopTyping = this.startTyping(channel);
    this.activityTracker.update(sessionId, 'Processing inject...');
    const abortController = this.taskController.create(sessionId);

    try {
      const content = `[Inject from user — handle this instruction, then stop and wait for further input. Do NOT resume the previous task automatically]: ${injectMessage}`;

      const result = await this.claudeCli.streamResumeSession(
        sessionId,
        content,
        {
          onActivity: (description, toolName, purpose) => {
            this.activityTracker.update(sessionId, description, toolName, purpose);
          },
          onToolUse: (toolName) => {
            this.activityTracker.countTool(sessionId, toolName);
          },
          onGoal: (goal) => {
            this.activityTracker.setGoal(sessionId, goal);
          },
          onSkillUse: (skillName) => {
            this.activityTracker.addSkill(sessionId, skillName);
          },
          onToolComplete: () => {
            this.taskController.checkGracefulStop(sessionId);
          },
        },
        abortController,
      );

      stopTyping();
      this.activityTracker.clear(sessionId);
      this.taskController.remove(sessionId);

      await this.sessionStore.update(sessionId, {
        lastActiveAt: new Date().toISOString(),
        messageCount: (this.sessionStore.get(sessionId)?.messageCount ?? 0) + 1,
      });

      const text = result.text.trim() || '> **Inject handled.** Waiting for your next instruction.';
      const chunks = splitMessage(text);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    } catch (err) {
      stopTyping();
      this.activityTracker.clear(sessionId);
      this.taskController.remove(sessionId);
      if (!abortController.signal.aborted) {
        logger.error(`Inject failed for session ${sessionId}:`, err);
        await channel.send(`> **Inject failed:** ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  private startTyping(channel: TextChannel): () => void {
    channel.sendTyping().catch(() => {});
    const interval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 9000);
    return () => clearInterval(interval);
  }

  private async downloadAttachments(message: Message): Promise<string[]> {
    if (!message.attachments.size) return [];

    const uploadDir = join('/tmp', 'mindbridge-uploads', message.channelId);
    await mkdir(uploadDir, { recursive: true });

    const paths: string[] = [];
    const maxSize = 25 * 1024 * 1024;

    for (const [, attachment] of message.attachments) {
      if (attachment.size > maxSize) {
        logger.warn(`Skipping attachment ${attachment.name}: too large (${attachment.size} bytes)`);
        continue;
      }

      try {
        const safeName = (attachment.name ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = join(uploadDir, `${Date.now()}-${safeName}`);

        const response = await fetch(attachment.url);
        if (!response.ok) {
          logger.warn(`Failed to fetch attachment ${attachment.name}: HTTP ${response.status}`);
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(filePath, buffer);
        paths.push(filePath);
        logger.info(`Downloaded attachment: ${attachment.name} (${this.formatSize(attachment.size)}) -> ${filePath}`);
      } catch (err) {
        logger.warn(`Failed to download attachment ${attachment.name}:`, err);
      }
    }

    return paths;
  }

  private async collectAttachableFiles(text: string): Promise<string[]> {
    const FILE_PATH_RE = /(\/[\w\-.\/]+\.\w+)\b/g;

    const matches = [...text.matchAll(FILE_PATH_RE)];
    const candidates = [...new Set(matches.map(m => m[1]))];

    const files: string[] = [];
    let totalSize = 0;
    const maxTotal = 25 * 1024 * 1024;
    const maxFiles = 10;
    const maxPerFile = 8 * 1024 * 1024;

    for (const filePath of candidates) {
      if (files.length >= maxFiles) break;

      try {
        const stats = await stat(filePath);
        if (!stats.isFile()) continue;
        if (stats.size > maxPerFile) continue;
        if (totalSize + stats.size > maxTotal) continue;

        files.push(filePath);
        totalSize += stats.size;
        logger.info(`Attaching file from response: ${filePath} (${this.formatSize(stats.size)})`);
      } catch {
        // File doesn't exist or can't be accessed
      }
    }

    return files;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Build a human-readable summary from activity data when Claude returns no text. */
  private buildActivitySummary(activity: SessionActivity | null, result: CliResult): string {
    const parts: string[] = [];

    parts.push('**Task completed** (no text response from Claude)\n');

    if (activity?.goal) {
      parts.push(`> **Goal:** ${activity.goal}\n`);
    }

    // Full action log — step-by-step what happened
    if (activity?.actionLog && activity.actionLog.length > 0) {
      parts.push('**Actions performed:**');
      for (let i = 0; i < activity.actionLog.length; i++) {
        const action = activity.actionLog[i];
        let line = `${i + 1}. **${action.toolName}** — ${action.description}`;
        if (action.purpose) {
          line += ` *(${action.purpose})*`;
        }
        parts.push(line);
      }
      parts.push('');
    }

    // Tool usage totals
    if (activity?.toolCounts) {
      const counts = activity.toolCounts;
      const totalTools = Object.values(counts).reduce((a, b) => a + b, 0);
      if (totalTools > 0) {
        const toolParts: string[] = [];
        for (const [tool, count] of Object.entries(counts)) {
          toolParts.push(`${tool} x${count}`);
        }
        parts.push(`**Totals:** ${toolParts.join(', ')}`);
      }
    }

    // Skills used
    if (activity?.usedSkills && activity.usedSkills.length > 0) {
      parts.push(`**Skills:** ${activity.usedSkills.join(', ')}`);
    }

    // Duration and cost
    const durationSec = Math.floor(result.durationMs / 1000);
    let duration: string;
    if (durationSec < 60) duration = `${durationSec}s`;
    else if (durationSec < 3600) duration = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
    else duration = `${Math.floor(durationSec / 3600)}h ${Math.floor((durationSec % 3600) / 60)}m`;

    parts.push(`**Duration:** ${duration}`);
    if (result.costUsd > 0) {
      parts.push(`**Cost:** $${result.costUsd.toFixed(4)}`);
    }

    return parts.join('\n');
  }
}
