import { readdir, open, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { CliSessionMeta, RecentActivity } from '../types.js';
import { logger } from '../utils/logger.js';

// How many bytes from the end of the JSONL to parse for recent-activity extraction.
// 500KB comfortably fits many assistant turns without loading 25+ MB files.
const TAIL_BYTES = 500_000;

// Below this event-age, we still treat the session as "running".
const RUNNING_WINDOW_MS = 60_000;

/**
 * Reads Claude CLI session metadata directly from JSONL files.
 * These live at {claudeHome}/projects/{projectPath}/{uuid}.jsonl
 */
export class CliSessionReader {
  private claudeHome: string;

  constructor(claudeHome: string) {
    this.claudeHome = claudeHome;
  }

  /** Convert a workDir path to the Claude CLI project directory name. */
  workDirToProjectPath(workDir: string): string {
    // Claude CLI converts absolute paths by replacing path separators with -
    // e.g. /Users/foo/workspace -> -Users-foo-workspace (Unix)
    // e.g. C:\Users\foo\workspace -> C-Users-foo-workspace (Windows)
    return workDir.replace(/[/\\:]/g, '-');
  }

  /** Convert a Claude CLI project directory name back to a workDir path. */
  private projectPathToWorkDir(projectDirName: string): string {
    // Reverse of workDirToProjectPath: replace - with the platform separator
    // e.g. -Users-foo-workspace -> /Users/foo/workspace (Unix)
    // e.g. C-Users-foo-workspace -> C\Users\foo\workspace (Windows)
    return projectDirName.replace(/-/g, sep);
  }

  /** Get the full path to the project's session directory. */
  getProjectDir(workDir: string): string {
    return join(this.claudeHome, 'projects', this.workDirToProjectPath(workDir));
  }

  /** Filter fulfilled, non-null results from Promise.allSettled. */
  private collectSettled<T>(results: PromiseSettledResult<T | null>[]): T[] {
    const out: T[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value !== null) out.push(r.value);
    }
    return out;
  }

  /** List all session IDs (UUIDs) in a project directory. */
  async listSessionIds(workDir: string): Promise<string[]> {
    const projectDir = this.getProjectDir(workDir);
    try {
      const entries = await readdir(projectDir);
      return entries
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''));
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        logger.debug(`No project directory found at ${projectDir}`);
        return [];
      }
      throw err;
    }
  }

  /** Read metadata from a single session JSONL file. */
  async readSessionMeta(workDir: string, sessionId: string): Promise<CliSessionMeta | null> {
    const filePath = join(this.getProjectDir(workDir), `${sessionId}.jsonl`);

    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let aiTitle: string | null = null;
    let userMessageCount = 0;

    try {
      const fileHandle = await open(filePath, 'r');
      try {
        const stream = createReadStream('', { fd: fileHandle.fd, autoClose: false });
        const rl = createInterface({ input: stream, crlfDelay: Infinity });

        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);

            // Track timestamps
            if (entry.timestamp) {
              if (!firstTimestamp) firstTimestamp = entry.timestamp;
              lastTimestamp = entry.timestamp;
            }

            // Extract ai-title (take the last one — it may be updated)
            if (entry.type === 'ai-title' && entry.aiTitle) {
              aiTitle = entry.aiTitle;
            }

            // Count user messages
            if (entry.type === 'user') {
              userMessageCount++;
            }
          } catch {
            // Skip malformed lines
          }
        }
      } finally {
        await fileHandle.close();
      }
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') return null;
      logger.warn(`Failed to read session JSONL ${filePath}:`, err);
      return null;
    }

    if (!firstTimestamp) return null;

    return {
      sessionId,
      aiTitle,
      createdAt: firstTimestamp,
      lastActiveAt: lastTimestamp ?? firstTimestamp,
      messageCount: userMessageCount,
      workDir,
    };
  }

  /** List all project directories (i.e. all workDirs that have sessions). */
  async listAllProjectDirs(): Promise<string[]> {
    const projectsDir = join(this.claudeHome, 'projects');
    try {
      const entries = await readdir(projectsDir);
      return entries.map(name => this.projectPathToWorkDir(name));
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * Find the correct workDir for a session by scanning all project dirs.
   * Uses hintWorkDir as a fast-path first check before scanning.
   * Returns null if the session cannot be found anywhere.
   */
  async resolveWorkDir(sessionId: string, hintWorkDir?: string): Promise<string | null> {
    // Fast path: check the hint workDir first
    if (hintWorkDir) {
      const ids = await this.listSessionIds(hintWorkDir).catch(() => [] as string[]);
      if (ids.includes(sessionId)) return hintWorkDir;
    }

    // Slow path: scan all project dirs in parallel
    const projectsDir = join(this.claudeHome, 'projects');
    let entries: string[];
    try {
      entries = await readdir(projectsDir);
    } catch {
      return null;
    }

    const results = await Promise.allSettled(
      entries.map(async name => {
        const files = await readdir(join(projectsDir, name)).catch(() => [] as string[]);
        return files.includes(`${sessionId}.jsonl`) ? this.projectPathToWorkDir(name) : null;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value !== null) return r.value;
    }

    return null;
  }

  /** Find a session by ID prefix across all project directories (runs dirs in parallel). */
  async findSessionByPrefix(prefix: string, workDirs: string[]): Promise<CliSessionMeta[]> {
    const perDir = await Promise.all(
      workDirs.map(async dir => {
        const ids = await this.listSessionIds(dir);
        const matching = ids.filter(id => id.startsWith(prefix));
        return this.collectSettled(
          await Promise.allSettled(matching.map(id => this.readSessionMeta(dir, id)))
        );
      })
    );
    return perDir.flat();
  }

  /**
   * Read the tail of a session's JSONL and extract recent activity.
   * Used as a fallback when the in-memory ActivityTracker is empty but the
   * session is still being written to by a Claude CLI process (e.g. background
   * job, detached session, bot restart mid-task).
   *
   * Parses the last ~500KB, walks events from the last `user` turn forward,
   * and accumulates tool uses, todos, text, and running-state heuristics.
   */
  async readRecentActivity(workDir: string, sessionId: string): Promise<RecentActivity | null> {
    const filePath = join(this.getProjectDir(workDir), `${sessionId}.jsonl`);

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) return null;

    const readSize = Math.min(fileStat.size, TAIL_BYTES);
    const startPos = fileStat.size - readSize;

    let text: string;
    const fileHandle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(readSize);
      await fileHandle.read(buffer, 0, readSize, startPos);
      text = buffer.toString('utf-8');
    } catch (err) {
      logger.warn(`Failed to tail session JSONL ${filePath}:`, err);
      await fileHandle.close();
      return null;
    }
    await fileHandle.close();

    const rawLines = text.split('\n');
    // If we started mid-file, the first line is probably truncated — discard it.
    if (startPos > 0 && rawLines.length > 0) rawLines.shift();

    // First pass: parse all lines into objects and locate the last `user` turn.
    const events: Array<Record<string, unknown>> = [];
    let lastUserIdx = -1;
    for (const line of rawLines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        events.push(obj);
        // A "real" user turn is a top-level `user` event carrying a text content.
        // `user` events that are tool_result replies also exist — those don't
        // start a new user turn, so we distinguish by message.content shape.
        if (obj.type === 'user' && this.isUserPromptEvent(obj)) {
          lastUserIdx = events.length - 1;
        }
      } catch { /* skip malformed */ }
    }

    if (events.length === 0) return null;

    // Second pass: walk forward from the last user turn, building snapshot.
    let lastTimestamp: string | null = null;
    let lastEventType: string | null = null;
    let lastText: string | null = null;
    let lastToolUse: RecentActivity['lastToolUse'] = null;
    let lastResultText: string | null = null;
    let todos: RecentActivity['todos'] = [];
    const toolCounts: Record<string, number> = {};

    const startIdx = Math.max(0, lastUserIdx + 1);
    for (let i = startIdx; i < events.length; i++) {
      const obj = events[i];
      if (typeof obj.timestamp === 'string') lastTimestamp = obj.timestamp;
      if (typeof obj.type === 'string') lastEventType = obj.type;

      if (obj.type === 'assistant' && obj.message && typeof obj.message === 'object') {
        const msg = obj.message as { content?: unknown };
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        for (const block of blocks) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
            lastText = b.text;
          }
          if (b.type === 'tool_use' && typeof b.name === 'string') {
            const input = (b.input && typeof b.input === 'object') ? b.input as Record<string, unknown> : undefined;
            lastToolUse = { name: b.name, input };
            toolCounts[b.name] = (toolCounts[b.name] ?? 0) + 1;
            if (b.name === 'TodoWrite' && input && Array.isArray(input.todos)) {
              todos = (input.todos as Array<Record<string, unknown>>).map(t => ({
                id: String(t.id ?? ''),
                content: String(t.content ?? ''),
                status: String(t.status ?? 'pending'),
              }));
            }
          }
        }
      }

      if (obj.type === 'result' && typeof (obj as { result?: unknown }).result === 'string') {
        lastResultText = (obj as { result: string }).result;
      }
    }

    const lastMs = lastTimestamp ? new Date(lastTimestamp).getTime() : 0;
    const ageMs = Date.now() - lastMs;
    const isRunning = lastEventType !== 'result' && ageMs < RUNNING_WINDOW_MS;

    return {
      sessionId,
      workDir,
      lastActiveAt: lastTimestamp ?? new Date().toISOString(),
      lastText,
      lastToolUse,
      toolCounts,
      todos,
      isRunning,
      lastResultText,
    };
  }

  /**
   * Check whether a `user`-typed event is an actual user prompt (text input)
   * rather than a tool_result reply. Tool results also serialize as type=user.
   */
  private isUserPromptEvent(obj: Record<string, unknown>): boolean {
    const msg = obj.message as { content?: unknown } | undefined;
    if (!msg || !Array.isArray(msg.content)) return false;
    // Tool-result user events only contain `tool_result` blocks.
    // Real user prompts contain `text` blocks (or plain string content).
    return msg.content.some(b => b && typeof b === 'object' && (b as { type?: string }).type === 'text');
  }

  /** List all sessions with metadata for a given workDir. */
  async listAllSessions(workDir: string): Promise<CliSessionMeta[]> {
    const ids = await this.listSessionIds(workDir);
    const sessions = this.collectSettled(
      await Promise.allSettled(ids.map(id => this.readSessionMeta(workDir, id)))
    );

    // Sort by most recently active first
    sessions.sort((a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );

    return sessions;
  }
}
