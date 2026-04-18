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
  model?: string;
  effort?: string;
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

/**
 * Snapshot of a session's recent state, reconstructed from the tail of its
 * JSONL file. Used when the live ActivityTracker has no data for the session
 * (e.g. bot isn't actively streaming, or job is running in background).
 */
export interface RecentActivity {
  sessionId: string;
  workDir: string;
  lastActiveAt: string;                // Timestamp of the most recent event in the tail
  lastText: string | null;             // Last assistant text block (after last user turn)
  lastToolUse: { name: string; input?: Record<string, unknown> } | null;
  toolCounts: Record<string, number>;  // Tool uses counted since the last user turn
  todos: Array<{ id: string; content: string; status: string }>;
  isRunning: boolean;                  // Last event was not `result` and is < 60s old
  lastResultText: string | null;       // If the last event is `result`, its text
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
  claudeModel: string;
  claudeEffort: string;
}
