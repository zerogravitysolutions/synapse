import type { SessionActivity } from '../services/activity-tracker.js';
import type { RecentActivity } from '../types.js';

export function formatActivity(activity: SessionActivity): string {
  const elapsed = Math.floor((Date.now() - activity.startedAt) / 1000);
  let duration: string;
  if (elapsed < 60) duration = `${elapsed}s`;
  else if (elapsed < 3600) duration = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  else duration = `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;

  const goal = activity.goal ?? 'Your request';
  const paragraphs: string[] = [];

  // Goal — bold first line only, rest as regular text
  const goalLines = goal.split('\n');
  const firstLine = goalLines[0];
  if (goalLines.length > 1) {
    paragraphs.push(`I'm working on **${firstLine}**\n${goalLines.slice(1).join('\n')}`);
  } else {
    paragraphs.push(`I'm working on **${goal}**.`);
  }

  // Task plan (from TodoWrite)
  if (activity.todos.length > 0) {
    const todoLines = activity.todos.map(t => {
      if (t.status === 'completed') return `- [x] ~~${t.content}~~`;
      if (t.status === 'in_progress') return `- [ ] **${t.content}** *(in progress)*`;
      return `- [ ] ${t.content}`;
    });
    paragraphs.push(`**Tasks:**\n${todoLines.join('\n')}`);
  }

  // Tools + skills
  const meta: string[] = [];
  const counts = activity.toolCounts;
  const totalSteps = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalSteps > 0) {
    const tools = formatToolSummary(counts);
    if (tools) meta.push(`Along the way I've ${tools}.`);
  }
  if (activity.usedSkills.length > 0) {
    const skills = activity.usedSkills.map(s => `\`/${s}\``).join(', ');
    meta.push(`Used ${skills}.`);
  }
  if (meta.length > 0) {
    paragraphs.push(meta.join(' '));
  }

  // Current action + purpose
  const current = activity.description;
  const generic = ['processing your message...', 'claude is thinking...', 'generating response...'];

  if (activity.purpose && !generic.includes(current.toLowerCase())) {
    paragraphs.push(`Right now: ${activity.purpose} — ${current}.`);
  } else if (activity.purpose) {
    paragraphs.push(`Right now: ${activity.purpose}.`);
  } else if (!generic.includes(current.toLowerCase())) {
    paragraphs.push(`Right now I'm ${current}.`);
  } else if (totalSteps > 0) {
    paragraphs.push(`Putting it all together for the response now.`);
  }

  paragraphs.push(`Been at it for about \`${duration}\`.`);

  return paragraphs.join('\n\n');
}

/**
 * Format a JSONL-derived activity snapshot for Discord.
 * Used when the live ActivityTracker has nothing (background / detached session).
 */
export function formatRecentActivity(recent: RecentActivity, context?: string): string {
  const parts: string[] = [];

  if (context) {
    parts.push(`> **You're watching for:** ${context}`);
  }

  const statusEmoji = recent.isRunning ? '🟢' : (recent.lastResultText ? '✅' : '⚪');
  const statusText = recent.isRunning
    ? 'Running'
    : recent.lastResultText
      ? 'Completed'
      : 'Idle';
  parts.push(`${statusEmoji} **Status:** ${statusText} *(from session log — no live stream)*`);

  // Task plan (from TodoWrite)
  if (recent.todos.length > 0) {
    const todoLines = recent.todos.map(t => {
      if (t.status === 'completed') return `- [x] ~~${t.content}~~`;
      if (t.status === 'in_progress') return `- [ ] **${t.content}** *(in progress)*`;
      return `- [ ] ${t.content}`;
    });
    parts.push(`**Tasks:**\n${todoLines.join('\n')}`);
  }

  // Tool counts since last user turn
  const totalTools = Object.values(recent.toolCounts).reduce((a, b) => a + b, 0);
  if (totalTools > 0) {
    const toolSummary = formatToolSummary(recent.toolCounts);
    if (toolSummary) parts.push(`Since your last message, Claude has ${toolSummary}.`);
  }

  // Current tool (if running)
  if (recent.isRunning && recent.lastToolUse) {
    parts.push(`**Right now:** using \`${recent.lastToolUse.name}\``);
  }

  // Last assistant text preview (clipped)
  if (recent.lastText) {
    const cleaned = recent.lastText.trim().replace(/\s+/g, ' ');
    const preview = cleaned.slice(0, 400);
    parts.push(`> ${preview}${cleaned.length > 400 ? '…' : ''}`);
  }

  // If completed, show the result preview
  if (!recent.isRunning && recent.lastResultText) {
    const cleaned = recent.lastResultText.trim().replace(/\s+/g, ' ');
    const preview = cleaned.slice(0, 400);
    parts.push(`**Final result:** ${preview}${cleaned.length > 400 ? '…' : ''}`);
  }

  // Freshness
  const ageSec = Math.floor((Date.now() - new Date(recent.lastActiveAt).getTime()) / 1000);
  let age: string;
  if (ageSec < 60) age = `${ageSec}s ago`;
  else if (ageSec < 3600) age = `${Math.floor(ageSec / 60)}m ${ageSec % 60}s ago`;
  else age = `${Math.floor(ageSec / 3600)}h ${Math.floor((ageSec % 3600) / 60)}m ago`;
  parts.push(`*Last session event: ${age}*`);

  return parts.join('\n\n');
}

function formatToolSummary(counts: Record<string, number>): string | null {
  const done: string[] = [];
  if (counts.Read) done.push(`read ${counts.Read} file${counts.Read > 1 ? 's' : ''}`);
  if (counts.Edit) done.push(`edited ${counts.Edit} file${counts.Edit > 1 ? 's' : ''}`);
  if (counts.Write) done.push(`written ${counts.Write} file${counts.Write > 1 ? 's' : ''}`);
  if (counts.Bash) done.push(`ran ${counts.Bash} command${counts.Bash > 1 ? 's' : ''}`);
  if (counts.Grep) done.push(`searched code ${counts.Grep}x`);
  if (counts.Glob) done.push(`found files ${counts.Glob}x`);
  if (counts.Agent) done.push(`ran ${counts.Agent} sub-task${counts.Agent > 1 ? 's' : ''}`);
  if (counts.WebSearch) done.push(`web searched ${counts.WebSearch}x`);
  for (const [tool, count] of Object.entries(counts)) {
    if (!['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Agent', 'WebSearch', 'Skill', 'TodoWrite', 'TodoRead'].includes(tool)) {
      done.push(`used ${tool} ${count}x`);
    }
  }
  if (done.length === 0) return null;
  const last = done.pop()!;
  return done.length > 0 ? `${done.join(', ')} and ${last}` : last;
}
