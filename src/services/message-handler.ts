import type { Client, Message, TextChannel } from 'discord.js';
import { EmbedBuilder, Events } from 'discord.js';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeCli } from './claude-cli.js';
import type { SessionStore } from './session-store.js';
import type { MessageQueue } from './message-queue.js';
import type { ActivityTracker } from './activity-tracker.js';
import { splitMessage } from '../utils/split-message.js';
import { logger } from '../utils/logger.js';

export class MessageHandler {
  private claudeCli: ClaudeCli;
  private sessionStore: SessionStore;
  private messageQueue: MessageQueue;
  private activityTracker: ActivityTracker;

  constructor(
    claudeCli: ClaudeCli,
    sessionStore: SessionStore,
    messageQueue: MessageQueue,
    activityTracker: ActivityTracker,
  ) {
    this.claudeCli = claudeCli;
    this.sessionStore = sessionStore;
    this.messageQueue = messageQueue;
    this.activityTracker = activityTracker;
  }

  register(client: Client): void {
    client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch(err => {
        logger.error('Message handler error:', err);
      });
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore bots and DMs
    if (message.author.bot) return;
    if (!message.inGuild()) return;

    const session = this.sessionStore.findByChannelId(message.channelId);
    if (!session) return;

    const content = message.content.trim();
    if (!content && !message.attachments.size) return;

    // Handle prefix commands
    if (content === '!status') {
      await this.handleStatus(message, session.id);
      return;
    }

    if (content === '!reset') {
      // Must go through queue to avoid race with in-flight Claude calls
      this.messageQueue.enqueue(session.id, async () => {
        await this.handleReset(message, session.id);
      });
      return;
    }

    if (content.startsWith('!ping')) {
      // Instant reply from activity tracker — no CLI call needed
      await this.handlePing(message, session.id);
      return;
    }

    // Forward to Claude via queue
    this.messageQueue.enqueue(session.id, async () => {
      await this.forwardToClaude(message, session.id);
    });
  }

  private async forwardToClaude(message: Message, sessionId: string): Promise<void> {
    const channel = message.channel as TextChannel;
    const stopTyping = this.startTyping(channel);

    // Mark session as active in tracker
    this.activityTracker.update(sessionId, 'Processing your message...');

    try {
      // Download any attachments so Claude can access them
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
          },
          onToolUse: (toolName) => {
            this.activityTracker.countTool(sessionId, toolName);
          },
          onGoal: (goal) => {
            this.activityTracker.setGoal(sessionId, goal);
          },
        },
      );

      stopTyping();
      this.activityTracker.clear(sessionId);

      // Update session metadata
      await this.sessionStore.update(sessionId, {
        lastActiveAt: new Date().toISOString(),
        messageCount: (this.sessionStore.get(sessionId)?.messageCount ?? 0) + 1,
      });

      // Collect any image/media files mentioned in the response
      const filesToSend = await this.collectAttachableFiles(result.text);

      // Send response, splitting if needed — attach files to the last chunk
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

  private async handleStatus(message: Message, sessionId: string): Promise<void> {
    const session = this.sessionStore.get(sessionId);
    if (!session) {
      await message.reply('Session not found.');
      return;
    }

    const lastActive = new Date(session.lastActiveAt);
    const seconds = Math.floor((Date.now() - lastActive.getTime()) / 1000);
    let ago: string;
    if (seconds < 60) ago = `${seconds}s ago`;
    else if (seconds < 3600) ago = `${Math.floor(seconds / 60)}m ago`;
    else ago = `${Math.floor(seconds / 3600)}h ago`;

    const embed = new EmbedBuilder()
      .setTitle('Session Status')
      .setColor(0x7C3AED)
      .addFields(
        { name: 'Session ID', value: `\`${sessionId}\``, inline: false },
        { name: 'Messages', value: String(session.messageCount), inline: true },
        { name: 'Last Active', value: ago, inline: true },
      );

    await message.reply({ embeds: [embed] });
  }

  private async handleReset(message: Message, oldSessionId: string): Promise<void> {
    const channel = message.channel as TextChannel;
    const session = this.sessionStore.get(oldSessionId);
    if (!session) {
      await message.reply('Session not found.');
      return;
    }

    try {
      // Archive old session
      await this.sessionStore.update(oldSessionId, {
        status: 'archived',
        archivedAt: new Date().toISOString(),
      });
      this.messageQueue.remove(oldSessionId);
      this.activityTracker.clear(oldSessionId);

      // Start a fresh session
      const result = await this.claudeCli.startSession(
        `You are starting a fresh session. The topic is: ${session.topic}. The previous session was reset by the user. Introduce yourself briefly.`
      );

      // Create new session pointing to the same channel
      const now = new Date().toISOString();
      await this.sessionStore.create({
        id: result.sessionId,
        topic: session.topic,
        status: 'active',
        channelId: channel.id,
        guildId: session.guildId,
        createdAt: now,
        lastActiveAt: now,
        messageCount: 1,
      });

      // Update channel topic
      await channel.setTopic(`Session: ${result.sessionId} | Topic: ${session.topic}`);

      const embed = new EmbedBuilder()
        .setTitle('Session Reset')
        .setDescription(result.text.slice(0, 4096))
        .setColor(0x10B981)
        .setFooter({ text: `New Session ID: ${result.sessionId}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      logger.info(`Reset session in channel ${channel.id}: ${oldSessionId} -> ${result.sessionId}`);
    } catch (err) {
      logger.error('Failed to reset session:', err);
      await message.reply(`Failed to reset: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private async handlePing(message: Message, sessionId: string): Promise<void> {
    logger.debug(`Ping requested for session ${sessionId}, tracker active: ${this.activityTracker.isActive(sessionId)}`);
    const activity = this.activityTracker.get(sessionId);

    if (!activity) {
      await message.reply('> **ping** — No active task. Claude is idle.');
      return;
    }

    const elapsed = Math.floor((Date.now() - activity.startedAt) / 1000);
    let duration: string;
    if (elapsed < 60) duration = `${elapsed}s`;
    else if (elapsed < 3600) duration = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
    else duration = `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;

    const counts = activity.toolCounts;
    const totalSteps = Object.values(counts).reduce((a, b) => a + b, 0);
    const parts: string[] = [];

    // The overarching goal
    if (activity.goal) {
      parts.push(`I'm working on **${activity.goal.toLowerCase()}**.`);
    } else {
      parts.push(`I'm working on your request.`);
    }

    // What's been done so far
    if (totalSteps > 0) {
      const done: string[] = [];
      if (counts.Read) done.push(`read ${counts.Read} file${counts.Read > 1 ? 's' : ''}`);
      if (counts.Edit) done.push(`edited ${counts.Edit} file${counts.Edit > 1 ? 's' : ''}`);
      if (counts.Write) done.push(`written ${counts.Write} file${counts.Write > 1 ? 's' : ''}`);
      if (counts.Bash) done.push(`ran ${counts.Bash} command${counts.Bash > 1 ? 's' : ''}`);
      if (counts.Grep) done.push(`searched the code ${counts.Grep} time${counts.Grep > 1 ? 's' : ''}`);
      if (counts.Glob) done.push(`looked up file patterns ${counts.Glob} time${counts.Glob > 1 ? 's' : ''}`);
      if (counts.Agent) done.push(`ran ${counts.Agent} sub-task${counts.Agent > 1 ? 's' : ''}`);
      if (counts.WebSearch) done.push(`searched the web ${counts.WebSearch} time${counts.WebSearch > 1 ? 's' : ''}`);
      for (const [tool, count] of Object.entries(counts)) {
        if (!['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Agent', 'WebSearch'].includes(tool)) {
          done.push(`used ${tool} ${count} time${count > 1 ? 's' : ''}`);
        }
      }
      const last = done.pop()!;
      const doneStr = done.length > 0 ? `${done.join(', ')} and ${last}` : last;
      parts.push(`So far I've ${doneStr}.`);
    }

    // Current action + purpose
    const current = activity.description;
    if (!this.isGenericActivity(current)) {
      let nowStr = `Right now I'm ${current.toLowerCase()}`;
      if (activity.purpose) {
        nowStr += ` — ${activity.purpose}`;
      }
      parts.push(nowStr.endsWith('.') ? nowStr : `${nowStr}.`);
    } else if (totalSteps > 0) {
      parts.push(`Now I'm putting it all together for the response.`);
    }

    parts.push(`Been at it for about **${duration}**.`);

    await message.reply(`> ${parts.join(' ')}`);
  }

  private isGenericActivity(desc: string): boolean {
    return ['processing your message...', 'claude is thinking...', 'generating response...'].includes(desc.toLowerCase());
  }

  private startTyping(channel: TextChannel): () => void {
    channel.sendTyping().catch(() => {});
    const interval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 9000);
    return () => clearInterval(interval);
  }

  /** Download Discord attachments to a temp directory so Claude can read them. */
  private async downloadAttachments(message: Message): Promise<string[]> {
    if (!message.attachments.size) return [];

    const uploadDir = join('/tmp', 'mindbridge-uploads', message.channelId);
    await mkdir(uploadDir, { recursive: true });

    const paths: string[] = [];
    const maxSize = 25 * 1024 * 1024; // 25 MB

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

  /** Scan response text for file paths and return those that exist. */
  private async collectAttachableFiles(text: string): Promise<string[]> {
    // Match absolute paths with a file extension (e.g. /workspace/project/settings.gradle)
    const FILE_PATH_RE = /(\/[\w\-.\/]+\.\w+)\b/g;

    const matches = [...text.matchAll(FILE_PATH_RE)];
    const candidates = [...new Set(matches.map(m => m[1]))];

    const files: string[] = [];
    let totalSize = 0;
    const maxTotal = 25 * 1024 * 1024;
    const maxFiles = 10;
    const maxPerFile = 8 * 1024 * 1024; // 8 MB per file

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
        // File doesn't exist or can't be accessed — skip
      }
    }

    return files;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
