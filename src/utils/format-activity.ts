import type { SessionActivity } from '../services/activity-tracker.js';

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
