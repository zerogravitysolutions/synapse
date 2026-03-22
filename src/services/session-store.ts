import fs from 'node:fs/promises';
import path from 'node:path';
import type { SessionData, SessionFile } from '../types.js';
import { logger } from '../utils/logger.js';

export class SessionStore {
  private sessions = new Map<string, SessionData>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data: SessionFile = JSON.parse(raw);
      this.sessions.clear();
      for (const [id, session] of Object.entries(data.sessions)) {
        this.sessions.set(id, session);
      }
      logger.info(`Loaded ${this.sessions.size} sessions from ${this.filePath}`);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        logger.info('No existing sessions file, starting fresh');
        this.sessions.clear();
      } else {
        throw err;
      }
    }
  }

  async save(): Promise<void> {
    const data: SessionFile = {
      version: 1,
      sessions: Object.fromEntries(this.sessions),
    };
    const json = JSON.stringify(data, null, 2);
    const tmpPath = `${this.filePath}.${Date.now()}.tmp`;

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tmpPath, json, 'utf-8');
    await fs.rename(tmpPath, this.filePath);
  }

  async create(session: SessionData): Promise<void> {
    this.sessions.set(session.id, session);
    await this.save();
    logger.info(`Created session ${session.id} (${session.topic})`);
  }

  async update(id: string, updates: Partial<SessionData>): Promise<SessionData | null> {
    const session = this.sessions.get(id);
    if (!session) return null;

    const updated = { ...session, ...updates };
    this.sessions.set(id, updated);
    await this.save();
    return updated;
  }

  get(id: string): SessionData | undefined {
    return this.sessions.get(id);
  }

  findByPrefix(prefix: string): SessionData[] {
    const results: SessionData[] = [];
    for (const [id, session] of this.sessions) {
      if (id.startsWith(prefix)) {
        results.push(session);
      }
    }
    return results;
  }

  findByChannelId(channelId: string): SessionData | undefined {
    for (const session of this.sessions.values()) {
      if (session.channelId === channelId && session.status === 'active') {
        return session;
      }
    }
    return undefined;
  }

  getActiveSessions(): SessionData[] {
    return [...this.sessions.values()]
      .filter(s => s.status === 'active')
      .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
  }

  async flush(): Promise<void> {
    await this.save();
  }
}
