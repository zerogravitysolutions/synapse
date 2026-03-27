import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

// --- Session (channel mapping — Discord-specific state only) ---

export interface ChannelMapping {
  sessionId: string;
  topic: string;
  status: 'active' | 'archived';
  channelId: string;
  guildId: string;
  workDir?: string;
  archivedAt?: string;
}

export interface ChannelMappingFile {
  version: 2;
  mappings: Record<string, ChannelMapping>;
}

// Legacy format for migration
export interface LegacySessionData {
  id: string;
  topic: string;
  status: 'active' | 'archived';
  channelId: string;
  guildId: string;
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
  archivedAt?: string;
  workDir?: string;
}

interface LegacySessionFile {
  version: 1;
  sessions: Record<string, LegacySessionData>;
}

export type SessionFile = ChannelMappingFile | LegacySessionFile;

// --- CLI Session Metadata (read from JSONL files) ---

export interface CliSessionMeta {
  sessionId: string;
  aiTitle: string | null;
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
  workDir: string;
}

// --- Claude CLI ---

export interface CliResult {
  sessionId: string;
  text: string;
  isError: boolean;
  costUsd: number;
  durationMs: number;
}

// --- Discord Commands ---

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

// --- Config ---

export interface Config {
  discordToken: string;
  discordAppId: string;
  categoryName: string;
  archiveCategoryName: string;
  sessionFilePath: string;
  claudeCliPath: string;
  claudeCliTimeout: number;
  claudeWorkDir: string;
  claudeHome: string;
  pollerIntervalMs: number;
}
