import type { Config } from './types.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    discordToken: requireEnv('DISCORD_TOKEN'),
    discordAppId: requireEnv('DISCORD_CLIENT_ID'),
    categoryName: process.env['SESSION_CATEGORY_NAME'] ?? 'CLAUDE SESSIONS',
    sessionFilePath: process.env['SESSION_FILE_PATH'] ?? '/data/sessions.json',
    claudeCliPath: process.env['CLAUDE_CLI_PATH'] ?? 'claude',
    claudeCliTimeout: parseInt(process.env['CLAUDE_CLI_TIMEOUT'] ?? '86400000', 10),
    claudeWorkDir: process.env['CLAUDE_WORK_DIR'] ?? process.cwd(),
  };
}
