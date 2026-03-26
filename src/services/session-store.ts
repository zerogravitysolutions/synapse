import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChannelMapping, ChannelMappingFile, LegacySessionData, SessionFile } from '../types.js';
import { logger } from '../utils/logger.js';

export class SessionStore {
  private mappings = new Map<string, ChannelMapping>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data: SessionFile = JSON.parse(raw);
      this.mappings.clear();

      if (data.version === 2) {
        // Current format
        for (const [id, mapping] of Object.entries(data.mappings)) {
          this.mappings.set(id, mapping);
        }
        logger.info(`Loaded ${this.mappings.size} channel mappings from ${this.filePath}`);
      } else if (data.version === 1) {
        // Migrate from legacy format
        for (const [id, session] of Object.entries(data.sessions)) {
          this.mappings.set(id, this.migrateFromLegacy(session));
        }
        logger.info(`Migrated ${this.mappings.size} sessions from v1 to v2 format`);
        await this.save();
      }
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        logger.info('No existing sessions file, starting fresh');
        this.mappings.clear();
      } else {
        throw err;
      }
    }
  }

  private migrateFromLegacy(session: LegacySessionData): ChannelMapping {
    return {
      sessionId: session.id,
      topic: session.topic,
      status: session.status,
      channelId: session.channelId,
      guildId: session.guildId,
      workDir: session.workDir,
      archivedAt: session.archivedAt,
    };
  }

  async save(): Promise<void> {
    const data: ChannelMappingFile = {
      version: 2,
      mappings: Object.fromEntries(this.mappings),
    };
    const json = JSON.stringify(data, null, 2);
    const tmpPath = `${this.filePath}.${Date.now()}.tmp`;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tmpPath, json, 'utf-8');
    await fs.rename(tmpPath, this.filePath);
  }

  async create(mapping: ChannelMapping): Promise<void> {
    this.mappings.set(mapping.sessionId, mapping);
    await this.save();
    logger.info(`Created mapping for session ${mapping.sessionId} (${mapping.topic})`);
  }

  async update(id: string, updates: Partial<ChannelMapping>): Promise<ChannelMapping | null> {
    const mapping = this.mappings.get(id);
    if (!mapping) return null;

    const updated = { ...mapping, ...updates };
    this.mappings.set(id, updated);
    await this.save();
    return updated;
  }

  get(id: string): ChannelMapping | undefined {
    return this.mappings.get(id);
  }

  findByPrefix(prefix: string): ChannelMapping[] {
    const results: ChannelMapping[] = [];
    for (const [id, mapping] of this.mappings) {
      if (id.startsWith(prefix)) {
        results.push(mapping);
      }
    }
    return results;
  }

  findByChannelId(channelId: string): ChannelMapping | undefined {
    for (const mapping of this.mappings.values()) {
      if (mapping.channelId === channelId && mapping.status === 'active') {
        return mapping;
      }
    }
    return undefined;
  }

  getActiveMappings(): ChannelMapping[] {
    return [...this.mappings.values()]
      .filter(m => m.status === 'active');
  }

  getAllMappings(): ChannelMapping[] {
    return [...this.mappings.values()];
  }

  async flush(): Promise<void> {
    await this.save();
  }
}
