import type { SessionActivity } from '../services/activity-tracker.js';

export function formatActivity(activity: SessionActivity): string {
  const elapsed = Math.floor((Date.now() - activity.startedAt) / 1000);
  let duration: string;
  if (elapsed < 60) duration = `${elapsed}s`;
  else if (elapsed < 3600) duration = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  else duration = `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;

  const goal = activity.goal ?? 'Your request';
  const paragraphs: string[] = [];

  // First paragraph: goal + what's been done (always bullet points)
  if (activity.completedSteps.length > 0) {
    paragraphs.push(`I'm working on **${goal}**. So far I've:`);
    paragraphs.push(activity.completedSteps.map(s => `- ${s}`).join('\n'));
  } else {
    paragraphs.push(`I'm working on **${goal}**.`);
  }

  // Second paragraph: tools + skills
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

  // Third paragraph: what's left + current action
  const current = activity.description;
  const generic = ['processing your message...', 'claude is thinking...', 'generating response...'];
  const now: string[] = [];

  if (activity.purpose) {
    // Split purpose by common delimiters to detect multiple items
    const purposes = activity.purpose
      .split(/(?:,\s*(?:and\s+)?|;\s*|\.\s+)/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (purposes.length > 1) {
      now.push('Still need to:');
      paragraphs.push(now.join(' '));
      now.length = 0;
      paragraphs.push(purposes.map(s => `- ${s.toLowerCase()}`).join('\n'));

      if (!generic.includes(current.toLowerCase())) {
        now.push(`Right now I'm ${current}.`);
      }
    } else if (!generic.includes(current.toLowerCase())) {
      now.push(`Still need to ${activity.purpose.toLowerCase()} — right now I'm ${current}.`);
    } else {
      now.push(`Still need to ${activity.purpose.toLowerCase()} — putting together the response now.`);
    }
  } else if (!generic.includes(current.toLowerCase())) {
    now.push(`Right now I'm ${current}.`);
  } else if (totalSteps > 0) {
    now.push(`Putting it all together for the response now.`);
  }

  now.push(`Been at it for about \`${duration}\`.`);
  paragraphs.push(now.join(' '));

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
    if (!['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Agent', 'WebSearch', 'Skill'].includes(tool)) {
      done.push(`used ${tool} ${count}x`);
    }
  }
  if (done.length === 0) return null;
  const last = done.pop()!;
  return done.length > 0 ? `${done.join(', ')} and ${last}` : last;
}
