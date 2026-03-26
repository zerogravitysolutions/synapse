import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

// --- Session ---

export interface SessionData {
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

export interface SessionFile {
  version: 1;
  sessions: Record<string, SessionData>;
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
  sessionFilePath: string;
  claudeCliPath: string;
  claudeCliTimeout: number;
  claudeWorkDir: string;
}
