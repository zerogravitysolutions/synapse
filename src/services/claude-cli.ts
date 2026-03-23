import { spawn } from 'node:child_process';
import type { Config } from '../types.js';
import type { CliResult } from '../types.js';
import { logger } from '../utils/logger.js';

const DISCORD_SYSTEM_PROMPT = [
  'You are responding inside a Discord channel. Format ALL responses for Discord:',
  '- Use **bold**, *italic*, `inline code`, and ```code blocks``` only.',
  '- NEVER use markdown tables (| col | col |). Use bullet lists or bold labels instead.',
  '- NEVER use horizontal rules (---).',
  '- Keep lines short. Use blank lines to separate sections.',
  '- Use > blockquotes for callouts.',
  '- For structured data, use bold labels like: **Name:** value',
  '- NEVER end your response with a todo list or checklist. If you need to show todos or next steps, place them BEFORE your final summary or conclusion.',
  '- Always end your response with a well-formatted markdown summary or conclusion. The last thing the user reads should be a clear, polished wrap-up — not a raw list, dangling bullet points, or incomplete thoughts.',
  '',
  'Task planning:',
  '- ALWAYS create a todo list (using TodoWrite) before starting any work. Think thoroughly about the steps needed.',
  '- Update the todo list as you progress — mark items complete, add new ones, remove unnecessary ones.',
  '- The todo list should reflect your current plan at all times.',
].join('\n');

export class ClaudeCli {
  private cliPath: string;
  private timeout: number;
  private workDir: string;

  constructor(config: Config) {
    this.cliPath = config.claudeCliPath;
    this.timeout = config.claudeCliTimeout;
    this.workDir = config.claudeWorkDir;
  }

  async startSession(message: string): Promise<CliResult> {
    return this.execute([
      '-p',
      '--dangerously-skip-permissions',
      '--system-prompt', DISCORD_SYSTEM_PROMPT,
      '--output-format', 'json',
      message,
    ]);
  }

  async resumeSession(sessionId: string, message: string): Promise<CliResult> {
    return this.execute([
      '-p',
      '--dangerously-skip-permissions',
      '--resume', sessionId,
      '--system-prompt', DISCORD_SYSTEM_PROMPT,
      '--output-format', 'json',
      message,
    ]);
  }

  async streamResumeSession(
    sessionId: string,
    message: string,
    callbacks: {
      onActivity: (description: string, toolName?: string, purpose?: string) => void;
      onToolUse: (toolName: string) => void;
      onGoal: (goal: string) => void;
      onSkillUse?: (skillName: string) => void;
      onTodoUpdate?: (todos: Array<{ id: string; content: string; status: string }>) => void;
      onToolComplete?: () => void;
    },
    externalAbort?: AbortController,
  ): Promise<CliResult> {
    const args = [
      '-p',
      '--dangerously-skip-permissions',
      '--resume', sessionId,
      '--system-prompt', DISCORD_SYSTEM_PROMPT,
      '--output-format', 'stream-json',
      '--verbose',
      message,
    ];

    const controller = externalAbort ?? new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startTime = Date.now();

    logger.debug(`Streaming: ${this.cliPath} ${args.join(' ')}`);

    try {
      return await new Promise<CliResult>((resolve, reject) => {
        const child = spawn(this.cliPath, args, {
          cwd: this.workDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
          signal: controller.signal,
        });

        let buffer = '';
        let resultText = '';
        let resultSessionId = sessionId;
        let isError = false;
        let costUsd = 0;
        let gotResult = false;
        let currentToolName = '';
        let totalSize = 0;
        const maxBuffer = 10 * 1024 * 1024;
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);

              // CLI stream-json uses its own event format (not raw API events)
              // Key types: system (init/task_started/task_progress), assistant, user, result
              logger.debug(`Stream event: type=${event.type} subtype=${event.subtype ?? ''}`);

              const { onActivity, onToolUse, onGoal } = callbacks;

              // Tool result — a tool just finished executing
              if (event.type === 'user') {
                callbacks.onToolComplete?.();
              }

              // Session loaded — CLI connected and processing
              if (event.type === 'system' && event.subtype === 'init') {
                onActivity('Claude is thinking...');
              }

              // Task started — captures the high-level goal (sub-agents)
              if (event.type === 'system' && event.subtype === 'task_started') {
                currentToolName = event.task_type ?? '';
                const desc = event.description ?? this.describeToolUse(currentToolName);
                if (event.description) onGoal(event.description);
                onActivity(desc, currentToolName);
              }

              // Task progress — ongoing tool activity
              if (event.type === 'system' && event.subtype === 'task_progress') {
                const toolName = event.last_tool_name ?? currentToolName;
                if (toolName) currentToolName = toolName;
                const desc = event.description ?? this.describeToolUse(toolName);
                onActivity(desc, toolName);
              }

              // Assistant message — extract tool actions + keep last response text
              if (event.type === 'assistant' && event.message) {
                const msg = event.message;
                const blocks = Array.isArray(msg.content) ? msg.content
                  : typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }]
                  : typeof msg === 'string' ? [{ type: 'text', text: msg }]
                  : [];

                let lastTextBlock = '';
                let eventText = '';
                for (const block of blocks) {
                  if (block.type === 'text' && block.text) {
                    eventText += block.text;
                    lastTextBlock = block.text;
                  }
                  if (block.type === 'tool_use' && block.name) {
                    currentToolName = block.name;
                    onToolUse(block.name);
                    const desc = this.describeToolUse(block.name, block.input);
                    const purpose = this.extractPurpose(lastTextBlock);
                    onActivity(desc, block.name, purpose ?? undefined);

                    // Track skill invocations
                    if (block.name === 'Skill' && block.input?.skill) {
                      callbacks.onSkillUse?.(String(block.input.skill));
                    }

                    // Track todo updates
                    if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
                      callbacks.onTodoUpdate?.(block.input.todos);
                    }
                  }
                }

                // Keep only the last assistant message's text (discard intermediate narration)
                if (eventText) {
                  resultText = eventText;
                }

                // First text from Claude becomes the goal (explains the plan)
                if (lastTextBlock && !currentToolName) {
                  const goal = this.extractPurpose(lastTextBlock);
                  if (goal) onGoal(goal);
                  onActivity('Generating response...');
                }
              }

              // CLI result event (final output)
              if (event.type === 'result') {
                gotResult = true;
                resultSessionId = event.session_id ?? sessionId;
                resultText = event.result ?? resultText;
                isError = event.is_error ?? false;
                costUsd = event.total_cost_usd ?? 0;
              }
            } catch {
              // Skip unparseable lines
            }
          }
        });

        child.stderr.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on('error', reject);
        child.on('close', (code) => {
          // Process remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer);
              if (event.type === 'result') {
                gotResult = true;
                resultSessionId = event.session_id ?? sessionId;
                resultText = event.result ?? resultText;
                isError = event.is_error ?? false;
                costUsd = event.total_cost_usd ?? 0;
              }
            } catch { /* ignore */ }
          }

          const stderr = Buffer.concat(stderrChunks).toString();

          if (code !== 0 && !resultText) {
            const detail = stderr || '(no output)';
            const err = new Error(`Claude CLI exited with code ${code}: ${detail}`);
            (err as any).stderr = stderr;
            (err as any).code = code;
            reject(err);
            return;
          }

          if (stderr) {
            logger.debug(`Claude CLI stderr: ${stderr.trim()}`);
          }

          if (!gotResult) {
            logger.debug('No result event in stream — using accumulated text');
          }

          resolve({
            sessionId: resultSessionId,
            text: resultText,
            isError,
            costUsd,
            durationMs: Date.now() - startTime,
          });
        });
      });
    } catch (err: unknown) {
      const error = err as Error & { stderr?: string; code?: string | number };

      if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
        throw new Error(`Claude CLI timed out after ${this.timeout / 1000}s`);
      }

      const stderr = error.stderr ?? '';
      throw new Error(`Claude CLI error: ${stderr || error.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private describeToolUse(toolName: string, input?: Record<string, unknown>): string {
    const detail = this.extractToolDetail(toolName, input);
    if (detail) return detail;

    const fallbacks: Record<string, string> = {
      Bash: 'Running a shell command',
      Edit: 'Editing a file',
      Read: 'Reading a file',
      Write: 'Writing a file',
      Grep: 'Searching code',
      Glob: 'Finding files',
      Agent: 'Running a sub-agent',
      WebSearch: 'Searching the web',
      WebFetch: 'Fetching a URL',
      NotebookEdit: 'Editing a notebook',
    };
    return fallbacks[toolName] ?? `Using ${toolName}`;
  }

  /** Extract a specific detail from tool input for richer activity descriptions. */
  private extractToolDetail(toolName: string, input?: Record<string, unknown>): string | undefined {
    if (!input) return undefined;

    const shorten = (path: string) => {
      // Show last 2 path segments: "src/services/auth.ts"
      const parts = path.split('/');
      return parts.length > 2 ? parts.slice(-2).join('/') : path;
    };

    switch (toolName) {
      case 'Read': {
        const fp = input.file_path as string | undefined;
        return fp ? `Reading \`${shorten(fp)}\`` : undefined;
      }
      case 'Edit': {
        const fp = input.file_path as string | undefined;
        return fp ? `Editing \`${shorten(fp)}\`` : undefined;
      }
      case 'Write': {
        const fp = input.file_path as string | undefined;
        return fp ? `Writing \`${shorten(fp)}\`` : undefined;
      }
      case 'Bash': {
        const cmd = input.command as string | undefined;
        if (!cmd) return undefined;
        // Strip comments and empty lines, take the first real command
        const meaningful = cmd.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'))[0] ?? cmd.split('\n')[0];
        const clean = meaningful.replace(/\s+/g, ' ').trim();
        return `Running \`${clean}\``;
      }
      case 'Grep': {
        const pat = input.pattern as string | undefined;
        return pat ? `Searching for \`${pat.slice(0, 40)}\`` : undefined;
      }
      case 'Glob': {
        const pat = input.pattern as string | undefined;
        return pat ? `Finding files matching \`${pat.slice(0, 40)}\`` : undefined;
      }
      case 'Agent': {
        const prompt = input.prompt as string | undefined;
        if (!prompt) return undefined;
        const first = prompt.split('\n')[0].slice(0, 60);
        return `Running sub-agent: ${first}`;
      }
      case 'WebSearch': {
        const q = input.query as string | undefined;
        return q ? `Searching the web for "${q.slice(0, 50)}"` : undefined;
      }
      case 'WebFetch': {
        const url = input.url as string | undefined;
        return url ? `Fetching ${url.slice(0, 60)}` : undefined;
      }
      default:
        return undefined;
    }
  }

  /** Extract purpose/intent from Claude's text preceding a tool call. */
  private extractPurpose(text: string): string | undefined {
    if (!text) return undefined;

    // Take the last sentence — it usually explains WHY the next tool is used
    const trimmed = text.trim();
    const sentences = trimmed.split(/(?<=[.!?:])\s+/);
    const last = sentences[sentences.length - 1]?.trim();
    if (!last || last.length < 10) return undefined;

    // Remove trailing punctuation
    const purpose = last.replace(/[.!?:]+$/, '');

    return purpose;
  }

  private async execute(args: string[]): Promise<CliResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    logger.debug(`Executing: ${this.cliPath} ${args.join(' ')}`);

    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(this.cliPath, args, {
          cwd: this.workDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
          signal: controller.signal,
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let totalSize = 0;
        const maxBuffer = 10 * 1024 * 1024;

        child.stdout.on('data', (chunk: Buffer) => {
          totalSize += chunk.length;
          if (totalSize <= maxBuffer) stdoutChunks.push(chunk);
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on('error', reject);
        child.on('close', (code) => {
          const stdout = Buffer.concat(stdoutChunks).toString();
          const stderr = Buffer.concat(stderrChunks).toString();
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            const detail = stderr || stdout || '(no output)';
            const err = new Error(`Claude CLI exited with code ${code}: ${detail}`);
            (err as any).stderr = stderr;
            (err as any).stdout = stdout;
            (err as any).code = code;
            reject(err);
          }
        });
      });

      if (stderr) {
        logger.debug(`Claude CLI stderr: ${stderr.trim()}`);
      }

      const parsed = JSON.parse(stdout);

      return {
        sessionId: parsed.session_id,
        text: parsed.result ?? '',
        isError: parsed.is_error ?? false,
        costUsd: parsed.total_cost_usd ?? 0,
        durationMs: parsed.duration_ms ?? 0,
      };
    } catch (err: unknown) {
      const error = err as Error & { stderr?: string; code?: string | number };

      if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
        throw new Error(`Claude CLI timed out after ${this.timeout / 1000}s`);
      }

      const stderr = error.stderr ?? '';
      throw new Error(`Claude CLI error: ${stderr || error.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
