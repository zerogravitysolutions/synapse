import { readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { CliSessionMeta } from '../types.js';
import { logger } from '../utils/logger.js';

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
    // Claude CLI converts absolute paths by replacing / with -
    // e.g. /Users/foo/workspace/synapse -> -Users-foo-workspace-synapse
    return workDir.replace(/\//g, '-');
  }

  /** Convert a Claude CLI project directory name back to a workDir path. */
  private projectPathToWorkDir(projectDirName: string): string {
    // Reverse of workDirToProjectPath: replace - with /
    // e.g. -Users-foo-workspace-synapse -> /Users/foo/workspace/synapse
    return projectDirName.replace(/-/g, '/');
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
