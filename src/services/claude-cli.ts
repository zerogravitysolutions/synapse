import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Config } from '../types.js';
import type { CliResult, AskQuestionEvent, MonitorEvent, UsageStats, AgentStartEvent } from '../types.js';
import { logger } from '../utils/logger.js';

/**
 * Resolve the executable to spawn so spawn() doesn't ENOENT on Windows.
 *
 * macOS / Linux: returns cliPath verbatim — single early-return, no filesystem
 * touch, no dep, bit-identical to the pre-fix call. The macOS code path
 * through this function is one comparison and one return statement.
 *
 * Windows: Node's spawn doesn't auto-resolve `.cmd`/`.bat` extensions, and
 * npm-installed CLIs ship as `claude.cmd` (not `claude`). We probe filesystem
 * (or PATH for bare names) for known extensions and return the first hit;
 * fall back to `<cliPath>.cmd` so spawn fails with a more informative error
 * than ENOENT if nothing exists.
 */
function resolveSpawnPath(cliPath: string): string {
  if (process.platform !== 'win32') return cliPath;
  // Already has an extension — trust the caller.
  if (/\.(cmd|bat|exe|ps1)$/i.test(cliPath)) return cliPath;
  // Absolute path: probe filesystem.
  if (isAbsolute(cliPath)) {
    for (const ext of ['.cmd', '.exe', '.bat']) {
      if (existsSync(cliPath + ext)) return cliPath + ext;
    }
    return cliPath;
  }
  // Bare name like 'claude': probe PATH for each extension.
  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(';').filter(Boolean);
  for (const ext of ['.cmd', '.exe', '.bat']) {
    for (const dir of dirs) {
      const candidate = `${dir}\\${cliPath}${ext}`;
      if (existsSync(candidate)) return candidate;
    }
  }
  // Last resort: `.cmd` is the standard npm-shim extension on Windows.
  return cliPath + '.cmd';
}

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
  'Task planning (STRICT — no exceptions):',
  '- You MUST call TodoWrite as your FIRST action on EVERY user message, even for one-step or trivial requests.',
  '- The user sees this list as their progress view in /ping. Skipping TodoWrite leaves them blind to what you are doing.',
  '- For trivial single-step requests, still create a one-item todo and mark it in_progress before acting.',
  '- Update the list as you progress: mark items completed, add new items as discovered, remove ones no longer relevant.',
  '- The todo list should reflect your current plan at all times.',
  '',
  'Long-running commands:',
  '- If a command or process might take more than 2 minutes (builds, tests, deployments, large data processing), do NOT run it as a single blocking command.',
  '- Instead, run it in the background and monitor it with a 60-second loop that checks progress and reports status to the user.',
  '- Example: start the process, then loop with `sleep 60` checking logs, output, or exit status, and print a brief progress update each iteration.',
].join('\n');

export class ClaudeCli {
  private cliPath: string;
  private timeout: number;
  private workDir: string;
  private model: string;
  private effort: string;

  constructor(config: Config) {
    this.cliPath = config.claudeCliPath;
    this.timeout = config.claudeCliTimeout;
    this.workDir = config.claudeWorkDir;
    this.model = config.claudeModel;
    this.effort = config.claudeEffort;
  }

  async startSession(message: string, workDir?: string, overrides?: { model?: string; effort?: string }): Promise<CliResult> {
    return this.execute([
      '-p',
      '--dangerously-skip-permissions',
      '--model', overrides?.model ?? this.model,
      '--effort', overrides?.effort ?? this.effort,
      '--system-prompt', DISCORD_SYSTEM_PROMPT,
      '--output-format', 'json',
      message,
    ], workDir);
  }

  async resumeSession(sessionId: string, message: string, workDir?: string, overrides?: { model?: string; effort?: string }): Promise<CliResult> {
    return this.execute([
      '-p',
      '--dangerously-skip-permissions',
      '--resume', sessionId,
      '--model', overrides?.model ?? this.model,
      '--effort', overrides?.effort ?? this.effort,
      '--system-prompt', DISCORD_SYSTEM_PROMPT,
      '--output-format', 'json',
      message,
    ], workDir);
  }

  /** Fork a session and send a message — safe for parallel use, no race condition with the parent. */
  async forkSession(sessionId: string, message: string, workDir?: string, overrides?: { model?: string; effort?: string }): Promise<CliResult> {
    return this.execute([
      '-p',
      '--dangerously-skip-permissions',
      '--resume', sessionId,
      '--fork-session',
      '--model', overrides?.model ?? this.model,
      '--effort', overrides?.effort ?? this.effort,
      '--system-prompt', DISCORD_SYSTEM_PROMPT,
      '--output-format', 'json',
      message,
    ], workDir);
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
      onAskQuestion?: (q: AskQuestionEvent) => void;
      onMonitorStart?: (m: MonitorEvent) => void;
      onAgentStart?: (a: AgentStartEvent) => void;
    },
    externalAbort?: AbortController,
    workDir?: string,
    overrides?: { model?: string; effort?: string },
  ): Promise<CliResult> {
    const args = [
      '-p',
      '--dangerously-skip-permissions',
      '--resume', sessionId,
      '--model', overrides?.model ?? this.model,
      '--effort', overrides?.effort ?? this.effort,
      '--system-prompt', DISCORD_SYSTEM_PROMPT,
      '--output-format', 'stream-json',
      '--verbose',
      message,
    ];

    const controller = externalAbort ?? new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startTime = Date.now();

    // No-op on macOS/Linux (returns cliPath unchanged); resolves .cmd/.exe on Windows.
    const spawnPath = resolveSpawnPath(this.cliPath);
    logger.debug(`Streaming: ${spawnPath} ${args.join(' ')}`);

    try {
      return await new Promise<CliResult>((resolve, reject) => {
        const child = spawn(spawnPath, args, {
          cwd: workDir ?? this.workDir,
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

        // Aggregate token usage across all assistant turns in this stream.
        // Each tool-cycle adds another assistant event with its own usage block;
        // summing gives the true cost of the whole exchange.
        const usage: UsageStats = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        };

        // Sub-agents emit many `agent_progress` events sharing one agentId.
        // Surface a Discord callout only on the FIRST event for each agent
        // (the one carrying the prompt); subsequent events update activity.
        const seenAgentIds = new Set<string>();

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

              // Progress events — emitted by the CLI itself (not the model) for
              // sub-agents, hooks, and web search. These were silently dropped
              // before, leaving the bot looking idle while a sub-agent ran.
              // Dispatch on `data.type` (the real discriminator — `subtype` is null).
              if (event.type === 'progress' && event.data && typeof event.data === 'object') {
                const pd = event.data as Record<string, unknown>;
                const pType = typeof pd.type === 'string' ? pd.type : '';

                if (pType === 'agent_progress') {
                  const agentId = typeof pd.agentId === 'string' ? pd.agentId : '';
                  const prompt = typeof pd.prompt === 'string' ? pd.prompt : '';
                  // First event for this agent carries the prompt — surface it.
                  if (agentId && !seenAgentIds.has(agentId)) {
                    seenAgentIds.add(agentId);
                    if (prompt && callbacks.onAgentStart) {
                      callbacks.onAgentStart({ agentId, prompt });
                    }
                    if (prompt) {
                      const short = prompt.split('\n')[0].slice(0, 80);
                      onActivity(`🤖 Sub-agent started: ${short}`);
                    } else {
                      onActivity(`🤖 Sub-agent ${agentId.slice(0, 8)} started`);
                    }
                  } else {
                    // Subsequent events — try to extract what the sub-agent is doing
                    const inner = (pd.message as Record<string, unknown> | undefined)?.message as
                      | Record<string, unknown> | undefined;
                    const innerContent = Array.isArray(inner?.content) ? inner!.content : [];
                    const tool = innerContent.find((b: unknown) =>
                      typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'tool_use',
                    ) as Record<string, unknown> | undefined;
                    const idShort = agentId.slice(0, 8);
                    if (tool && typeof tool.name === 'string') {
                      onActivity(`🤖 Sub-agent ${idShort}: ${this.describeToolUse(tool.name, tool.input as Record<string, unknown>)}`);
                    } else {
                      onActivity(`🤖 Sub-agent ${idShort}: working`);
                    }
                  }
                } else if (pType === 'hook_progress') {
                  // Hooks fire frequently (PreToolUse / PostToolUse on every call) —
                  // update activity but never spam Discord.
                  const hookName = typeof pd.hookName === 'string' ? pd.hookName : 'unknown';
                  onActivity(`🪝 Hook: ${hookName}`);
                } else if (pType === 'query_update') {
                  const q = typeof pd.query === 'string' ? pd.query : '';
                  if (q) onActivity(`🔎 Searching: "${q.slice(0, 60)}"`);
                } else if (pType === 'search_results_received') {
                  const q = typeof pd.query === 'string' ? pd.query : '';
                  const n = typeof pd.resultCount === 'number' ? pd.resultCount : 0;
                  onActivity(`🔎 ${n} result${n === 1 ? '' : 's'} for "${q.slice(0, 50)}"`);
                }
              }

              // Assistant message — extract tool actions + keep last response text
              if (event.type === 'assistant' && event.message) {
                const msg = event.message;

                // Accumulate token usage for the final footer.
                // Cache fields may be missing on older models — default to 0.
                if (msg.usage && typeof msg.usage === 'object') {
                  const u = msg.usage as Record<string, unknown>;
                  usage.inputTokens += Number(u.input_tokens ?? 0);
                  usage.outputTokens += Number(u.output_tokens ?? 0);
                  usage.cacheReadTokens += Number(u.cache_read_input_tokens ?? 0);
                  usage.cacheCreateTokens += Number(u.cache_creation_input_tokens ?? 0);
                }

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

                    // Goal fallback — when Claude jumps straight to a tool without
                    // emitting a text block first, the input's `description` field
                    // (Bash/Edit/Write/Read all carry one) becomes the goal.
                    // setGoal is idempotent — only the FIRST description sticks.
                    if (typeof block.input?.description === 'string' && block.input.description.trim()) {
                      onGoal(block.input.description.trim());
                    }

                    // Track skill invocations
                    if (block.name === 'Skill' && block.input?.skill) {
                      callbacks.onSkillUse?.(String(block.input.skill));
                    }

                    // Track todo updates
                    if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
                      callbacks.onTodoUpdate?.(block.input.todos);
                    }

                    // AskUserQuestion — Claude is blocking for an answer it can't get
                    // in headless mode. Surface the question so the user can /interrupt
                    // or send the answer as a message.
                    if (block.name === 'AskUserQuestion' && block.input) {
                      const q = this.parseAskQuestion(block.input as Record<string, unknown>);
                      if (q && callbacks.onAskQuestion) callbacks.onAskQuestion(q);
                    }

                    // Monitor — Claude started a long-running watcher. Surface what's
                    // being watched so the user knows why the bot looks "stuck".
                    if (block.name === 'Monitor' && block.input) {
                      const m = this.parseMonitor(block.input as Record<string, unknown>);
                      if (m && callbacks.onMonitorStart) callbacks.onMonitorStart(m);
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

          const hasAnyUsage =
            usage.inputTokens || usage.outputTokens ||
            usage.cacheReadTokens || usage.cacheCreateTokens;

          resolve({
            sessionId: resultSessionId,
            text: resultText,
            isError,
            costUsd,
            durationMs: Date.now() - startTime,
            usage: hasAnyUsage ? usage : undefined,
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
      const parts = path.split(/[/\\]/);
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
        // Prefer Claude's own `description` — always more readable than the raw
        // command, especially for heredocs where the first line is just `<<EOF`
        // and reveals nothing about what's actually being run.
        const desc = input.description as string | undefined;
        if (typeof desc === 'string' && desc.trim()) {
          return desc.trim();
        }
        const cmd = input.command as string | undefined;
        if (!cmd) return undefined;
        // Fallback: first non-comment line of the command.
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

  /**
   * Pull the first question + options out of an AskUserQuestion tool input.
   * The tool can carry multiple questions; we surface only the first to keep
   * the Discord output tractable. Returns null if the shape is unexpected.
   */
  private parseAskQuestion(input: Record<string, unknown>): AskQuestionEvent | null {
    const questions = input.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    const first = questions[0];
    if (!first || typeof first !== 'object') return null;
    const f = first as Record<string, unknown>;
    const question = typeof f.question === 'string' ? f.question : null;
    if (!question) return null;

    const options: AskQuestionEvent['options'] = [];
    if (Array.isArray(f.options)) {
      for (const opt of f.options) {
        if (!opt || typeof opt !== 'object') continue;
        const o = opt as Record<string, unknown>;
        if (typeof o.label === 'string') {
          options.push({
            label: o.label,
            description: typeof o.description === 'string' ? o.description : undefined,
          });
        }
      }
    }

    return {
      question,
      header: typeof f.header === 'string' ? f.header : undefined,
      multiSelect: f.multiSelect === true,
      options,
    };
  }

  /** Pull the description, command, and persistent flag out of a Monitor tool input. */
  private parseMonitor(input: Record<string, unknown>): MonitorEvent | null {
    const description = typeof input.description === 'string' ? input.description : null;
    const command = typeof input.command === 'string' ? input.command : null;
    if (!description || !command) return null;
    return {
      description,
      command,
      persistent: input.persistent === true,
    };
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

  private async execute(args: string[], workDir?: string): Promise<CliResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // No-op on macOS/Linux (returns cliPath unchanged); resolves .cmd/.exe on Windows.
    const spawnPath = resolveSpawnPath(this.cliPath);
    logger.debug(`Executing: ${spawnPath} ${args.join(' ')}`);

    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(spawnPath, args, {
          cwd: workDir ?? this.workDir,
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
